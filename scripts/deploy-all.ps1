#Requires -Version 5.1
<#
.SYNOPSIS
  GitHub Pages + GAS①（管理）+ GAS②（API）を一度に反映する。

.PARAMETER GasOnly
  clasp push と両デプロイ更新のみ（git しない）

.PARAMETER PagesOnly
  git commit（必要時）と push のみ（clasp しない）

.DESCRIPTION
  docs/config.js の既存デプロイIDを使い、clasp deploy -i で更新する。
  新規デプロイは作らないため URL・権限設定は維持される。
#>
param(
  [switch]$GasOnly,
  [switch]$PagesOnly,
  [switch]$ExportStatic
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($GasOnly -and $PagesOnly) {
  throw '-GasOnly と -PagesOnly は同時指定できません'
}

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Get-DeploymentIdsFromConfig {
  $configPath = Join-Path $Root 'docs\config.js'
  if (-not (Test-Path $configPath)) {
    throw "docs/config.js が見つかりません: $configPath"
  }
  $text = Get-Content -Raw -Encoding UTF8 $configPath

  if ($text -notmatch "API_URL:\s*'https://script\.google\.com/macros/s/([^/]+)/exec'") {
    throw 'docs/config.js から API_URL（GAS②）のデプロイIDを取得できません'
  }
  $apiId = $Matches[1]

  if ($text -notmatch "DASHBOARD_URL:\s*'https://script\.google\.com/macros/s/([^/]+)/exec'") {
    throw 'docs/config.js から DASHBOARD_URL（GAS①）のデプロイIDを取得できません'
  }
  $dashId = $Matches[1]

  if ($apiId -eq $dashId) {
    throw 'API_URL と DASHBOARD_URL のデプロイIDが同一です。config.js を確認してください'
  }

  return @{
    Gas2ApiId       = $apiId
    Gas1DashboardId = $dashId
  }
}

function Assert-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name が見つかりません。PATH を確認してください"
  }
}

function Deploy-Gas {
  Assert-Command 'clasp'
  $ids = Get-DeploymentIdsFromConfig
  Write-Host "GAS② (API)       : $($ids.Gas2ApiId)"
  Write-Host "GAS① (Dashboard) : $($ids.Gas1DashboardId)"

  Write-Step 'clasp push（マニフェスト含む強制上書き）'
  clasp push -f | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "clasp push が失敗しました (exit=$LASTEXITCODE)" }

  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
  Write-Step 'GAS②（JSON API）デプロイ更新'
  clasp deploy -i $ids.Gas2ApiId -d "API update $stamp" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "GAS② deploy が失敗しました (exit=$LASTEXITCODE)" }

  Write-Step 'GAS①（管理ダッシュボード）デプロイ更新'
  clasp deploy -i $ids.Gas1DashboardId -d "Dashboard update $stamp" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "GAS① deploy が失敗しました (exit=$LASTEXITCODE)" }
}

function Deploy-Pages {
  Assert-Command 'git'
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'

  Write-Step 'Git 状態確認'
  git status --short

  $dirty = git status --porcelain
  if ($dirty) {
    Write-Step '未コミット変更を commit'
    git add -A
    git commit -m "Deploy: sync ($stamp)"
    if ($LASTEXITCODE -ne 0) { throw "git commit が失敗しました (exit=$LASTEXITCODE)" }
  } else {
    Write-Host 'コミット対象の変更はありません（push のみ実行）'
  }

  Write-Step 'git push（GitHub Pages 反映）'
  git push
  if ($LASTEXITCODE -ne 0) { throw "git push が失敗しました (exit=$LASTEXITCODE)" }
}

if (-not $PagesOnly) {
  Deploy-Gas
}
if (-not $GasOnly) {
  if ($ExportStatic) {
    Write-Step '静的プリセット export（docs/data/manifest-*.json）'
    & (Join-Path $Root 'scripts\export-static.ps1')
  }
  Deploy-Pages
}

Write-Host ""
Write-Host '完了しました。' -ForegroundColor Green
if (-not $PagesOnly) {
  $ids = Get-DeploymentIdsFromConfig
  Write-Host "  GAS② : https://script.google.com/macros/s/$($ids.Gas2ApiId)/exec"
  Write-Host "  GAS① : https://script.google.com/macros/s/$($ids.Gas1DashboardId)/exec"
}
if (-not $GasOnly) {
  Write-Host '  Pages : https://snakamurako-coder.github.io/grammarquiz/'
  Write-Host '  （Actions のビルド完了後、通常数分で反映）'
}
