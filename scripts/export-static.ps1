#Requires -Version 5.1
<#
.SYNOPSIS
  GAS② exportStatic API から学習モード別 manifest を docs/data/ に生成する。
  ハッシュ付きファイル名 + manifest-index.json（schemaVersion 2）を出力する。
#>
param(
  [string]$ApiUrl
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

. (Join-Path $PSScriptRoot 'manifest-publish.ps1')

if (-not $ApiUrl) {
  $configPath = Join-Path $Root 'docs\config.js'
  $text = Get-Content -Raw -Encoding UTF8 $configPath
  if ($text -notmatch "API_URL:\s*'([^']+)'") {
    throw 'docs/config.js から API_URL を取得できません'
  }
  $ApiUrl = $Matches[1]
}

$exportUrl = $ApiUrl + '?action=exportStatic'
Write-Host "Fetching: $exportUrl"

$response = Invoke-RestMethod -Uri $exportUrl -Method Get
if ($response.status -ne 'success') {
  throw 'exportStatic failed: ' + ($response.message | ConvertTo-Json -Compress)
}

$data = $response.data
$outDir = Join-Path $Root 'docs\data'

$exportVersion = [string](Get-ObjectProp $data 'version')
$exportAt = [string](Get-ObjectProp $data 'exportedAt')
if (-not $exportVersion) { throw 'exportStatic の応答に version がありません' }
if (-not $exportAt) { $exportAt = (Get-Date).ToUniversalTime().ToString('o') }

$modeSources = @{}
foreach ($item in $script:ManifestModeDefs) {
  $modeSources[$item.Mode] = $data
}

Publish-ManifestSetToDataDir -OutDir $outDir `
  -ModeSources $modeSources `
  -Version $exportVersion `
  -ExportedAt $exportAt

Write-Host "Version: $exportVersion"
