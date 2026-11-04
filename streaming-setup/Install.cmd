@echo off
rem Sets up the Burpee Judge streaming server (MediaMTX). Windows will ask to
rem allow changes: that's for the firewall rules.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
