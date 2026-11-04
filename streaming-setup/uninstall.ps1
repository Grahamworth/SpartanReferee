# Removes the Burpee Judge streaming server: stops it, and removes its start-up
# task, firewall rules, desktop shortcuts and folder.
param([string]$InstallDir)
. (Join-Path $PSScriptRoot 'common.ps1')
if (-not $InstallDir) { $InstallDir = $DefaultInstallDir }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    Start-Process powershell.exe -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-InstallDir', "`"$InstallDir`"")
    exit
}

try {
    Get-Process mediamtx -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$InstallDir*" } | Stop-Process -Force -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $AppName -Confirm:$false -ErrorAction SilentlyContinue
    Get-NetFirewallRule -Group $AppName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    $desktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
    Get-ChildItem $desktop -Filter 'Streaming - *.lnk' -ErrorAction SilentlyContinue | Remove-Item -Force
    Start-Sleep -Seconds 1
    # Run from inside the folder being removed: leave it to finish after we exit.
    if ($PSScriptRoot -like "$InstallDir*") {
        Start-Process cmd.exe -WindowStyle Hidden -ArgumentList "/c timeout /t 2 >nul & rmdir /s /q `"$InstallDir`""
    } elseif (Test-Path $InstallDir) {
        Remove-Item -Recurse -Force $InstallDir
    }
    Write-Host 'The streaming server has been removed.' -ForegroundColor Green
} catch {
    Write-Host "Removal failed: $($_.Exception.Message)" -ForegroundColor Yellow
}
Read-Host 'Press Enter to close'
