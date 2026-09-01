#Requires -Version 5.1
<#
  Shared manifest publish helpers for docs/data.
  Used by export-static.ps1 (GAS API) and publish-manifest-local.ps1 (manual drop).
#>

Set-StrictMode -Version Latest

$script:ManifestModeDefs = @(
  @{ Mode = 'grammar'; Label = 'grammar'; Base = 'manifest-grammar' },
  @{ Mode = 'vocab'; Label = 'vocab'; Base = 'manifest-vocab' },
  @{ Mode = 'reading'; Label = 'reading'; Base = 'manifest-reading' },
  @{ Mode = 'ai'; Label = 'ai'; Base = 'manifest-ai-conversation' }
)

$script:ManifestLegacyFixedNames = @(
  'manifest-grammar.json',
  'manifest-vocab.json',
  'manifest-reading.json',
  'manifest-ai-conversation.json',
  'manifest.json'
)

function Get-ManifestContentHash12 {
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

function Get-ModeLabelJa {
  param([Parameter(Mandatory = $true)][string]$Mode)
  switch ($Mode) {
    'grammar' { return [string][char]0x6587 + [char]0x6CD5 + [char]0x30FB + [char]0x8A9E + [char]0x6CD5 + [char]0x6F14 + [char]0x7FD2 }
    'vocab' { return [string][char]0x5358 + [char]0x8A9E + [char]0x5B66 + [char]0x7FD2 }
    'reading' { return [string][char]0x97F3 + [char]0x8AAD + [char]0x7DF4 + [char]0x7FD2 }
    'ai' { return 'AI' + [char]0x82F1 + [char]0x4F1A + [char]0x8A71 }
    default { return $Mode }
  }
}

function New-EmptyModeManifest {
  param(
    [Parameter(Mandatory = $true)][string]$Mode,
    [Parameter(Mandatory = $true)][string]$ModeLabel,
    [string]$Version = '',
    [string]$ExportedAt = ''
  )
  return [ordered]@{
    schemaVersion = 2
    mode          = $Mode
    modeLabel     = $ModeLabel
    version       = $Version
    exportedAt    = $ExportedAt
    catalog       = @{}
    vocabCatalog  = @{ presets = @() }
    questions     = @{ }
    vocabWords    = @{ }
  }
}

function Get-ObjectProp {
  param($Object, [string]$Name)
  if ($null -eq $Object) { return $null }
  if ($Object -is [hashtable] -or $Object -is [System.Collections.IDictionary]) {
    if ($Object.ContainsKey($Name)) { return $Object[$Name] }
    return $null
  }
  $p = $Object.PSObject.Properties[$Name]
  if ($null -eq $p) { return $null }
  return $p.Value
}

function ConvertTo-ModeManifest {
  param(
    [Parameter(Mandatory = $true)]$Source,
    [Parameter(Mandatory = $true)][string]$Mode,
    [Parameter(Mandatory = $true)][string]$ModeLabel,
    [string]$Version = '',
    [string]$ExportedAt = ''
  )

  $src = @{}
  if ($null -ne $Source) {
    $Source.PSObject.Properties | ForEach-Object { $src[$_.Name] = $_.Value }
  }

  $fromLabel = Get-ObjectProp $src 'modeLabel'
  $fromVersion = Get-ObjectProp $src 'version'
  $fromExported = Get-ObjectProp $src 'exportedAt'
  $resolvedLabel = if ($fromLabel) { [string]$fromLabel } else { $ModeLabel }
  $manifest = New-EmptyModeManifest -Mode $Mode -ModeLabel $resolvedLabel `
    -Version ($(if ($fromVersion) { [string]$fromVersion } else { $Version })) `
    -ExportedAt ($(if ($fromExported) { [string]$fromExported } else { $ExportedAt }))

  switch ($Mode) {
    'grammar' {
      $catalog = Get-ObjectProp $src 'catalog'
      $questions = Get-ObjectProp $src 'questions'
      if ($catalog) { $manifest.catalog = $catalog }
      if ($questions) { $manifest.questions = $questions }
    }
    'vocab' {
      $vocabCatalog = Get-ObjectProp $src 'vocabCatalog'
      $vocabWords = Get-ObjectProp $src 'vocabWords'
      if ($vocabCatalog) { $manifest.vocabCatalog = $vocabCatalog }
      if ($vocabWords) { $manifest.vocabWords = $vocabWords }
    }
    { $_ -in @('reading', 'ai') } { }
  }

  return $manifest
}

function Read-JsonFile {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path $Path)) { return $null }
  $raw = [System.IO.File]::ReadAllText($Path, [System.Text.UTF8Encoding]::new($false))
  if (-not $raw.Trim()) { return $null }
  return $raw | ConvertFrom-Json
}

function Resolve-ModeManifestFromDataDir {
  param(
    [Parameter(Mandatory = $true)][string]$OutDir,
    [Parameter(Mandatory = $true)]$ModeDef,
    $ExistingIndex
  )

  $fixedPath = Join-Path $OutDir ($ModeDef.Base + '.json')
  $fixed = Read-JsonFile -Path $fixedPath
  if ($fixed) {
    Write-Host ('  input: {0}' -f (Split-Path $fixedPath -Leaf))
    return $fixed
  }

  $entry = $null
  if ($ExistingIndex -and $ExistingIndex.modes) {
    $entry = $ExistingIndex.modes.($ModeDef.Mode)
  }
  if ($entry -and $entry.path) {
    $rel = [string]$entry.path -replace '^data/', ''
    $hashedPath = Join-Path $OutDir $rel
    $existing = Read-JsonFile -Path $hashedPath
    if ($existing) {
      Write-Host ('  keep: {0}' -f (Split-Path $hashedPath -Leaf))
      return $existing
    }
  }

  if ($ModeDef.Mode -in @('reading', 'ai')) {
    Write-Host ('  stub: {0}' -f $ModeDef.Mode)
    return $null
  }

  return $null
}

function Publish-ManifestSetToDataDir {
  param(
    [Parameter(Mandatory = $true)][string]$OutDir,
    [Parameter(Mandatory = $true)][hashtable]$ModeSources,
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$ExportedAt
  )

  if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir | Out-Null
  }

  $indexModes = @{}
  $writtenPaths = @()

  foreach ($item in $script:ManifestModeDefs) {
    $source = $ModeSources[$item.Mode]
    $labelJa = Get-ModeLabelJa -Mode $item.Mode
    $manifest = ConvertTo-ModeManifest -Source $source -Mode $item.Mode -ModeLabel $labelJa `
      -Version $Version -ExportedAt $ExportedAt
    $jsonText = ($manifest | ConvertTo-Json -Depth 20 -Compress)
    $hash = Get-ManifestContentHash12 -Text $jsonText
    $fileName = '{0}.{1}.json' -f $item.Base, $hash
    $relativePath = 'data/' + $fileName
    $manifestPath = Join-Path $OutDir $fileName
    [System.IO.File]::WriteAllText($manifestPath, $jsonText, [System.Text.UTF8Encoding]::new($false))
    Write-Host "Written: $manifestPath (hash=$hash)"
    $writtenPaths += $manifestPath
    $indexModes[$item.Mode] = [ordered]@{
      hash = $hash
      path = $relativePath
    }
  }

  $index = [ordered]@{
    schemaVersion = 2
    version       = $Version
    exportedAt    = $ExportedAt
    modes         = $indexModes
  }

  $indexPath = Join-Path $OutDir 'manifest-index.json'
  $indexJson = ($index | ConvertTo-Json -Depth 10 -Compress)
  [System.IO.File]::WriteAllText($indexPath, $indexJson, [System.Text.UTF8Encoding]::new($false))
  Write-Host "Written: $indexPath"
  $writtenPaths += $indexPath

  foreach ($legacy in $script:ManifestLegacyFixedNames) {
    $legacyPath = Join-Path $OutDir $legacy
    if (Test-Path $legacyPath) {
      Remove-Item -Force $legacyPath
      Write-Host "Removed legacy: $legacyPath"
    }
  }

  Get-ChildItem -Path $OutDir -Filter 'manifest-*.json' | ForEach-Object {
    if ($writtenPaths -notcontains $_.FullName) {
      Remove-Item -Force $_.FullName
      Write-Host "Removed stale: $($_.FullName)"
    }
  }

  return $index
}

function Build-ModeSourcesFromDataDir {
  param(
    [Parameter(Mandatory = $true)][string]$OutDir
  )

  $existingIndex = Read-JsonFile -Path (Join-Path $OutDir 'manifest-index.json')
  $modeSources = @{}
  $versions = @()
  $exportedAts = @()

  Write-Host 'Resolving manifest sources...'
  foreach ($item in $script:ManifestModeDefs) {
    $resolved = Resolve-ModeManifestFromDataDir -OutDir $OutDir -ModeDef $item -ExistingIndex $existingIndex
    if ($null -eq $resolved) {
      if ($item.Mode -in @('reading', 'ai')) {
        $modeSources[$item.Mode] = $null
        continue
      }
      throw ('Missing manifest for mode "{0}". Place {1} in docs/data or keep the hashed file from manifest-index.json.' -f $item.Mode, ($item.Base + '.json'))
    }
    $modeSources[$item.Mode] = $resolved
    if ($resolved.version) { $versions += [string]$resolved.version }
    if ($resolved.exportedAt) { $exportedAts += [string]$resolved.exportedAt }
  }

  $version = if ($versions.Count -gt 0) { ($versions | Sort-Object -Descending)[0] } else { '' }
  if (-not $version -and $existingIndex -and $existingIndex.version) {
    $version = [string]$existingIndex.version
  }
  if (-not $version) {
    throw 'Could not determine manifest version. Check the version field in the GAS export.'
  }

  $exportedAt = if ($exportedAts.Count -gt 0) {
    ($exportedAts | Sort-Object -Descending)[0]
  } elseif ($existingIndex -and $existingIndex.exportedAt) {
    [string]$existingIndex.exportedAt
  } else {
    (Get-Date).ToUniversalTime().ToString('o')
  }

  return @{
    ModeSources = $modeSources
    Version     = $version
    ExportedAt  = $exportedAt
  }
}
