#Requires -Version 5.1
<#
.SYNOPSIS
  GAS② exportStatic API から学習モード別 manifest を docs/data/ に生成する。
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
    [Parameter(Mandatory = $true)][string]$FileName
  )

  $manifest = [ordered]@{
    schemaVersion = 1
    mode          = $Mode
    modeLabel     = $ModeLabel
    manifestFile  = $FileName
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
    { $_ -in @('vocab', 'reading') } {
      if ($Source.vocabCatalog) { $manifest.vocabCatalog = $Source.vocabCatalog }
      if ($Source.vocabWords) { $manifest.vocabWords = $Source.vocabWords }
    }
    'ai' { }
  }

  return $manifest
}

$modeFiles = @(
  @{ Mode = 'grammar'; Label = '文法・語法演習'; File = 'manifest-grammar.json' },
  @{ Mode = 'vocab'; Label = '単語学習'; File = 'manifest-vocab.json' },
  @{ Mode = 'reading'; Label = '音読練習'; File = 'manifest-reading.json' },
  @{ Mode = 'ai'; Label = 'AI英会話'; File = 'manifest-ai-conversation.json' }
)

foreach ($item in $modeFiles) {
  $manifest = New-ModeManifest -Source $data -Mode $item.Mode -ModeLabel $item.Label -FileName $item.File
  $manifestPath = Join-Path $outDir $item.File
  $manifest | ConvertTo-Json -Depth 20 -Compress | Set-Content -Path $manifestPath -Encoding UTF8
  Write-Host "Written: $manifestPath"
}

Write-Host "Version: $($data.version)"
