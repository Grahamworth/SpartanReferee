# Opens the connection details page, with this computer's current address
# (it can change when the computer joins a different network).
. (Join-Path $PSScriptRoot 'common.ps1')
$settings = Read-Settings $PSScriptRoot
if (-not $settings) { $settings = [pscustomobject]@{ Stations = 4; Password = $null } }
$page = Write-ConnectionPage $PSScriptRoot $settings
Start-Process $page
