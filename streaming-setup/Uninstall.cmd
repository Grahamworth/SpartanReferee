@echo off
rem Removes the Burpee Judge streaming server (MediaMTX) and everything the installer set up.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
