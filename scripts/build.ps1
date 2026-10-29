# Cross-compile ferry for all platforms into .\dist (PowerShell).
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$version = if ($env:VERSION) { $env:VERSION } else { '1.0.0' }
New-Item -ItemType Directory -Force -Path dist | Out-Null
$env:CGO_ENABLED = '0'
foreach ($t in 'windows/amd64','windows/arm64','darwin/amd64','darwin/arm64','linux/amd64','linux/arm64') {
  $os, $arch = $t.Split('/')
  $ext = if ($os -eq 'windows') { '.exe' } else { '' }
  $env:GOOS = $os; $env:GOARCH = $arch
  go build -mod=vendor -trimpath -ldflags "-s -w -X main.version=$version" -o "dist/ferry-$os-$arch$ext" .
  Write-Host "built dist/ferry-$os-$arch$ext"
}
Remove-Item Env:GOOS, Env:GOARCH
