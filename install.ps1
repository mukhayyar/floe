# Install Floe on Windows. In PowerShell:
#
#   irm https://raw.githubusercontent.com/mukhayyar/floe/main/install.ps1 | iex
#
# Options: set these before running it (or pass them to a saved copy: .\install.ps1 -Uninstall)
#   -Uninstall / $env:FLOE_UNINSTALL=1   stop Floe and remove it (settings in ~\.config\floe stay; add -Purge to remove them too)
#   -Version vX.Y.Z / $env:FLOE_VERSION   install that release instead of the latest
#
# What it does: checks for Orca, installs Bun if it's missing, downloads the latest release
# (Floe.exe plus the proxy and sage sources) into %LOCALAPPDATA%\Floe, adds Floe to the Start
# menu and starts it. Floe starts its proxy itself, and adds itself to your startup apps.
param(
  [switch]$Uninstall = ($env:FLOE_UNINSTALL -eq "1"),
  [switch]$Purge = ($env:FLOE_PURGE -eq "1"),
  [string]$Version = $(if ($env:FLOE_VERSION) { $env:FLOE_VERSION } else { "latest" })
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue" # Invoke-WebRequest is many times slower with the progress bar

$Repo = "mukhayyar/floe"
$Prefix = if ($env:FLOE_PREFIX) { $env:FLOE_PREFIX } else { Join-Path $env:LOCALAPPDATA "Floe" }
$Logs = Join-Path $Prefix "logs"
$StartMenu = Join-Path ([Environment]::GetFolderPath("Programs")) "Floe.lnk"
$ConfigDir = Join-Path $HOME ".config\floe"

function Say($m) { Write-Host "==> $m" -ForegroundColor Blue }
function Warn($m) { Write-Host " !  $m" -ForegroundColor Yellow }
# `irm | iex` runs this in your own PowerShell session, where `exit` would close the window
function Die($m) { Write-Host " x  $m" -ForegroundColor Red; throw "Floe wasn't installed." }

function Stop-Floe {
  # the app, then the proxy it supervises (bun running <prefix>\proxy\src\server.ts)
  Get-Process -Name "floe" -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$Prefix*" } | Stop-Process -Force -ErrorAction SilentlyContinue
  $proxy = Join-Path $Prefix "proxy\src\server.ts"
  Get-CimInstance Win32_Process -Filter "Name = 'bun.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$proxy*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 500
}

if ($Uninstall) {
  Say "Stopping Floe"
  Stop-Floe
  Remove-Item -Force -ErrorAction SilentlyContinue $StartMenu
  # the startup entry Floe added for itself
  Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "Floe" -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Prefix
  if ($Purge) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $ConfigDir }
  Write-Host "Floe is uninstalled."
  return
}

# ---------------------------------------------------------------- checks
if (-not [Environment]::Is64BitOperatingSystem) { Die "Floe needs 64-bit Windows." }
$orcaSeen = (Test-Path (Join-Path $env:APPDATA "orca")) -or (Test-Path (Join-Path $env:LOCALAPPDATA "Programs\Orca"))
if (-not $orcaSeen) {
  Warn "Orca doesn't seem to be installed. Floe talks to Orca; get it at https://orca.stably.ai"
  Warn "Floe still installs, and shows `"Orca is offline`" until Orca is running."
}

$bun = Get-Command bun -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
if (-not $bun -and (Test-Path "$HOME\.bun\bin\bun.exe")) { $bun = "$HOME\.bun\bin\bun.exe" }
if (-not $bun) {
  Say "Installing Bun (it runs Floe's proxy)"
  try { powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex" | Out-Null } catch {}
  $bun = "$HOME\.bun\bin\bun.exe"
  if (-not (Test-Path $bun)) { Die "Bun didn't install. Install it from https://bun.sh and run this again." }
}

$browsers = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
if (-not ($browsers | Where-Object { Test-Path $_ })) { Warn "No Chrome or Edge found. Floe works without one, but needs one to draw the sages in the Hosts tab." }
if (-not (Get-Command claude -ErrorAction SilentlyContinue) -and -not (Test-Path "$HOME\.local\bin\claude.exe")) {
  Warn "Claude Code isn't installed. Everything works except the Ask tab: https://claude.com/claude-code"
}

# ---------------------------------------------------------------- download
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("floe-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $tmp | Out-Null
function Fetch($url, $out) {
  foreach ($n in 1..4) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $out
      if ($out -like "*.zip") { Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::OpenRead($out).Dispose() }
      return $true
    } catch { Start-Sleep -Seconds ($n * 2) }
  }
  return $false
}

try {
  if ($Version -eq "latest") {
    try { $Version = (Invoke-RestMethod -UseBasicParsing "https://api.github.com/repos/$Repo/releases/latest").tag_name } catch { $Version = "" }
  }
  if (-not $Version) { Die "Couldn't find a Floe release. Check your connection and try again." }
  Say "Downloading Floe $Version"
  if (-not (Fetch "https://github.com/$Repo/archive/refs/tags/$Version.zip" "$tmp\src.zip")) { Die "Couldn't download Floe $Version. Check your connection and try again." }
  Expand-Archive -Path "$tmp\src.zip" -DestinationPath $tmp -Force
  $src = Get-ChildItem -Path $tmp -Directory -Filter "floe-*" | Select-Object -First 1
  if (-not $src -or -not (Test-Path (Join-Path $src.FullName "proxy"))) { Die "The download doesn't look like Floe." }
  if (-not (Fetch "https://github.com/$Repo/releases/download/$Version/Floe-windows-x64.exe" "$tmp\floe.exe")) {
    Die "Floe $Version has no Windows build. Try a newer release, or see desktop\README.md to build it."
  }

  # ---------------------------------------------------------------- install
  Say "Installing to $Prefix"
  Stop-Floe
  New-Item -ItemType Directory -Force -Path $Prefix, $Logs | Out-Null
  foreach ($part in "proxy", "sage", "brain") {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $Prefix $part)
    Copy-Item -Recurse (Join-Path $src.FullName $part) (Join-Path $Prefix $part)
  }
  Copy-Item -ErrorAction SilentlyContinue (Join-Path $src.FullName "README.md") $Prefix
  $exe = Join-Path $Prefix "floe.exe"
  Copy-Item -Force "$tmp\floe.exe" $exe
  Unblock-File -Path $exe -ErrorAction SilentlyContinue

  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut($StartMenu)
  $lnk.TargetPath = $exe
  $lnk.WorkingDirectory = $Prefix
  $lnk.Description = "Your Orca agents at the top of the screen"
  $lnk.Save()
} finally {
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp
}

if ($env:FLOE_NO_START -eq "1") { Write-Host "Installed (not started)."; return }
Start-Process -FilePath $exe -WorkingDirectory $Prefix
$up = $false
foreach ($i in 1..30) {
  try { Invoke-RestMethod -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:7717/health" | Out-Null; $up = $true; break } catch { Start-Sleep -Milliseconds 500 }
}
Write-Host ""
if ($up) { Write-Host "Floe is running at the top of your screen." -ForegroundColor Green }
else { Warn "Floe started, but its proxy didn't answer yet. Check $Logs\proxy.log" }
Write-Host "  Alt+Space opens it - drag the pill to move it - Floe's tray icon has Settings and Quit"
Write-Host "  Logs: $Logs - Settings: $ConfigDir\config.json"
Write-Host "  Uninstall: `$env:FLOE_UNINSTALL=1; irm https://raw.githubusercontent.com/$Repo/main/install.ps1 | iex"
