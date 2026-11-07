# Cross-compile ferry for all platforms into .\dist (PowerShell; needs bun: https://bun.sh).
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
bun scripts/build.ts @args
