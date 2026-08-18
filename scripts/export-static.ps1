#Requires -Version 5.1
<#
.SYNOPSIS
  GAS② exportStatic API から docs/data/manifest.json を生成する。
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

$manifestPath = Join-Path $outDir 'manifest.json'
$data | ConvertTo-Json -Depth 20 -Compress | Set-Content -Path $manifestPath -Encoding UTF8

Write-Host "Written: $manifestPath"
Write-Host "Version: $($data.version)"
