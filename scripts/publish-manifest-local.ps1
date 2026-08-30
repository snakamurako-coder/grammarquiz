#Requires -Version 5.1
<#
.SYNOPSIS
  Publish manually dropped manifest files in docs/data (fixed names -> hashed + index).
#>
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

. (Join-Path $PSScriptRoot 'manifest-publish.ps1')

$outDir = Join-Path $Root 'docs\data'
$built = Build-ModeSourcesFromDataDir -OutDir $outDir

Write-Host ''
Write-Host 'Publishing manifest-index.json and hashed manifest files...'
$index = Publish-ManifestSetToDataDir -OutDir $outDir `
  -ModeSources $built.ModeSources `
  -Version $built.Version `
  -ExportedAt $built.ExportedAt

Write-Host ''
Write-Host ('Version: {0}' -f $index.version)
