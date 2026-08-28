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
if (-not (Test-Path $outDir)) {
  New-Item -ItemType Directory -Path $outDir | Out-Null
}

function New-ModeManifest {
  param(
    [Parameter(Mandatory = $true)]$Source,
    [Parameter(Mandatory = $true)][string]$Mode,
    [Parameter(Mandatory = $true)][string]$ModeLabel,
    [Parameter(Mandatory = $true)][string]$BaseFileName
  )

  $manifest = [ordered]@{
    schemaVersion = 2
    mode          = $Mode
    modeLabel     = $ModeLabel
    version       = $Source.version
    exportedAt    = $Source.exportedAt
    catalog       = @{}
    vocabCatalog  = @{ presets = @() }
    questions     = @{}
    vocabWords    = @{}
  }

  switch ($Mode) {
    'grammar' {
      if ($Source.catalog) { $manifest.catalog = $Source.catalog }
      if ($Source.questions) { $manifest.questions = $Source.questions }
    }
    { $_ -in @('vocab') } {
      if ($Source.vocabCatalog) { $manifest.vocabCatalog = $Source.vocabCatalog }
      if ($Source.vocabWords) { $manifest.vocabWords = $Source.vocabWords }
    }
    { $_ -in @('reading', 'ai') } { }
  }

  return $manifest
}

function Get-ContentHash12 {
  param([Parameter(Mandatory = $true)][string]$Text)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $hashBytes = $sha.ComputeHash($bytes)
    $hex = -join ($hashBytes | ForEach-Object { $_.ToString('x2') })
    return $hex.Substring(0, 12)
  } finally {
    $sha.Dispose()
  }
}

$modeFiles = @(
  @{ Mode = 'grammar'; Label = '文法・語法演習'; Base = 'manifest-grammar' },
  @{ Mode = 'vocab'; Label = '単語学習'; Base = 'manifest-vocab' },
  @{ Mode = 'reading'; Label = '音読練習'; Base = 'manifest-reading' },
  @{ Mode = 'ai'; Label = 'AI英会話'; Base = 'manifest-ai-conversation' }
)

$indexModes = @{}
$writtenPaths = @()

foreach ($item in $modeFiles) {
  $manifest = New-ModeManifest -Source $data -Mode $item.Mode -ModeLabel $item.Label -BaseFileName $item.Base
  $jsonText = ($manifest | ConvertTo-Json -Depth 20 -Compress)
  $hash = Get-ContentHash12 -Text $jsonText
  $fileName = '{0}.{1}.json' -f $item.Base, $hash
  $relativePath = 'data/' + $fileName
  $manifestPath = Join-Path $outDir $fileName
  [System.IO.File]::WriteAllText($manifestPath, $jsonText, [System.Text.UTF8Encoding]::new($false))
  Write-Host "Written: $manifestPath (hash=$hash)"
  $writtenPaths += $manifestPath
  $indexModes[$item.Mode] = [ordered]@{
    hash = $hash
    path = $relativePath
  }
  $manifest | Add-Member -NotePropertyName 'manifestFile' -NotePropertyValue $fileName -Force
}

$index = [ordered]@{
  schemaVersion = 2
  version       = $data.version
  exportedAt    = $data.exportedAt
  modes         = $indexModes
}

$indexPath = Join-Path $outDir 'manifest-index.json'
$indexJson = ($index | ConvertTo-Json -Depth 10 -Compress)
[System.IO.File]::WriteAllText($indexPath, $indexJson, [System.Text.UTF8Encoding]::new($false))
Write-Host "Written: $indexPath"
$writtenPaths += $indexPath

# 旧固定名 manifest を削除
$legacyNames = @(
  'manifest-grammar.json',
  'manifest-vocab.json',
  'manifest-reading.json',
  'manifest-ai-conversation.json',
  'manifest.json'
)
foreach ($legacy in $legacyNames) {
  $legacyPath = Join-Path $outDir $legacy
  if (Test-Path $legacyPath) {
    Remove-Item -Force $legacyPath
    Write-Host "Removed legacy: $legacyPath"
  }
}

# 今回書いた index + ハッシュ付き以外の manifest-*.json を削除
Get-ChildItem -Path $outDir -Filter 'manifest-*.json' | ForEach-Object {
  if ($writtenPaths -notcontains $_.FullName) {
    Remove-Item -Force $_.FullName
    Write-Host "Removed stale: $($_.FullName)"
  }
}

Write-Host "Version: $($data.version)"
