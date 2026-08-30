#Requires -Version 5.1
<#
.SYNOPSIS
  Learning set data update: publish local manifest files and push to GitHub Pages.
#>
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Write-Step([string]$Message) {
  Write-Host ''
  Write-Host "==> $Message" -ForegroundColor Cyan
}

Write-Step 'Publish manifest (docs/data)'
& (Join-Path $Root 'scripts\publish-manifest-local.ps1')

Write-Step 'Git status'
git status --short

$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
$dirty = git status --porcelain
if ($dirty) {
  Write-Step 'Commit learning set manifest'
  git add -A
  git commit -m "chore: update learning set manifest ($stamp)"
  if ($LASTEXITCODE -ne 0) { throw "git commit failed (exit=$LASTEXITCODE)" }
} else {
  Write-Host 'No changes to commit (push only)'
}

Write-Step 'git push (GitHub Pages)'
git push
if ($LASTEXITCODE -ne 0) { throw "git push failed (exit=$LASTEXITCODE)" }

Write-Host ''
Write-Host 'Learning set data update completed.' -ForegroundColor Green
Write-Host '  Pages: https://snakamurako-coder.github.io/grammarquiz/'
