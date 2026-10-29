# Install the latest ferry release on Windows (no admin needed).
#   irm https://raw.githubusercontent.com/anupam42/Ferry/main/scripts/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$repo = 'anupam42/Ferry'
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
$rel  = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
$ver  = $rel.tag_name.TrimStart('v')
$url  = "https://github.com/$repo/releases/download/$($rel.tag_name)/ferry_${ver}_windows_${arch}.zip"
$dest = Join-Path $env:LOCALAPPDATA 'Programs\ferry'
$tmp  = Join-Path ([IO.Path]::GetTempPath()) "ferry-$ver.zip"
Write-Host "downloading $url"
Invoke-WebRequest $url -OutFile $tmp
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Expand-Archive $tmp -DestinationPath $dest -Force
Remove-Item $tmp
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -notlike "*$dest*") {
  [Environment]::SetEnvironmentVariable('Path', "$userPath;$dest", 'User')
  Write-Host "added $dest to your PATH (open a new terminal)"
}
Write-Host "installed ferry $ver to $dest"
