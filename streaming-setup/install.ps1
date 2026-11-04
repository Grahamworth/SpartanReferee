<#
  Burpee Judge streaming server: sets up MediaMTX on this computer so phones
  running Larix can stream to it, and the Burpee Judge app on this computer can
  judge those streams.

  What it does:
    1. Downloads MediaMTX from its official GitHub release and checks it
       against the published checksum.
    2. Writes its settings: phones send RTMP (port 1935) or SRT (8890); the
       app watches over WebRTC (8889, with 8189 for the video itself).
       Publishing needs a password (made here, kept on re-install); watching
       is open on the local network.
    3. Opens those ports in Windows Firewall for the local network only.
    4. Starts the server now, and again each time you log in.
    5. Puts "Connection details", "Start" and "Stop" shortcuts on the desktop.

  Run it by double-clicking Install.cmd. Options (from PowerShell):
    -Stations 6        how many station addresses to list (default 4)
    -NoPassword        let any phone on the network publish without a password
    -NoAutostart       don't start the server at log-in
    -Version v1.21.3   MediaMTX version to install
    -Tailscale         set up Tailscale (streaming over the internet) without asking
    -NoTailscale       don't offer Tailscale
    -NoRecording       don't keep recordings of the stations
    -KeepDays 14       how many days to keep recordings (default 14)
#>
param(
    [int]$Stations = 4,
    [switch]$NoPassword,
    [switch]$NoAutostart,
    [string]$Version = 'v1.21.3',
    [string]$InstallDir,
    [switch]$Tailscale,
    [switch]$NoTailscale,
    [switch]$NoRecording,
    [int]$KeepDays = 14
)

. (Join-Path $PSScriptRoot 'common.ps1')
if (-not $InstallDir) { $InstallDir = $DefaultInstallDir }

# Firewall rules need administrator rights: ask for them (Windows shows a prompt).
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Stations', $Stations, '-Version', $Version, '-InstallDir', "`"$InstallDir`"")
    if ($NoPassword) { $argList += '-NoPassword' }
    if ($NoAutostart) { $argList += '-NoAutostart' }
    if ($Tailscale) { $argList += '-Tailscale' }
    if ($NoTailscale) { $argList += '-NoTailscale' }
    if ($NoRecording) { $argList += '-NoRecording' }
    $argList += @('-KeepDays', $KeepDays)
    Start-Process powershell.exe -Verb RunAs -ArgumentList $argList
    exit
}

function Step($text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Red }

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

    # ------------------------------------------------------------------ stop a running copy
    Get-Process mediamtx -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$InstallDir*" } | Stop-Process -Force -ErrorAction SilentlyContinue

    # ------------------------------------------------------------------ download and check
    Step "Downloading MediaMTX $Version"
    $zipName = "mediamtx_${Version}_windows_amd64.zip"
    $base = "https://github.com/bluenviron/mediamtx/releases/download/$Version"
    $tmp = Join-Path $env:TEMP "bj-mediamtx-$([guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    $zip = Join-Path $tmp $zipName
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$zipName" -OutFile $zip
    Invoke-WebRequest -UseBasicParsing -Uri "$base/checksums.sha256" -OutFile (Join-Path $tmp 'checksums.sha256')
    $line = Get-Content (Join-Path $tmp 'checksums.sha256') | Where-Object { $_ -match [regex]::Escape($zipName) } | Select-Object -First 1
    if (-not $line) { throw "No checksum published for $zipName." }
    $expected = ($line -split '\s+')[0].ToLower()
    $actual = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
    if ($expected -ne $actual) { throw "The download doesn't match MediaMTX's published checksum, so it wasn't installed." }
    Write-Host 'Checksum OK.'
    Expand-Archive -Force -Path $zip -DestinationPath $tmp
    Copy-Item -Force (Join-Path $tmp 'mediamtx.exe') $InstallDir
    Copy-Item -Force (Join-Path $tmp 'LICENSE') (Join-Path $InstallDir 'MEDIAMTX-LICENSE.txt') -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $tmp

    # ------------------------------------------------------------------ settings
    Step 'Writing settings'
    $old = Read-Settings $InstallDir
    $password = $null
    if (-not $NoPassword) {
        if ($old -and $old.Password) { $password = $old.Password }  # keep the phones' addresses working
        else { $password = -join ((48..57) + (97..122) | Get-Random -Count 10 | ForEach-Object { [char]$_ }) }
    }
    $settings = [pscustomobject]@{ Stations = $Stations; Password = $password; Version = $Version }
    $settings | ConvertTo-Json | Set-Content -Path (Join-Path $InstallDir 'settings.json') -Encoding UTF8

    if ($password) {
        $users = @"
authInternalUsers:
  # Phones (Larix) publish with this name and password.
  - user: larix
    pass: $password
    ips: []
    permissions:
      - action: publish
        path:
  # Anyone on the network may watch (the judging app, a check in a browser).
  - user: any
    pass:
    ips: []
    permissions:
      - action: read
        path:
      - action: playback
        path:
"@
    } else {
        $users = @"
authInternalUsers:
  - user: any
    pass:
    ips: []
    permissions:
      - action: publish
        path:
      - action: read
        path:
      - action: playback
        path:
"@
    }
    # A recording of every station on this computer, for reviews and disputes: one file per hour per station,
    # deleted after $KeepDays days. About 1.5 GB an hour per station at 720p.
    $recDir = (Join-Path $InstallDir 'recordings').Replace('\', '/')
    $record = if ($NoRecording) { '' } else { @"
pathDefaults:
  record: yes
  recordPath: $recDir/%path/%Y-%m-%d_%H-%M-%S-%f%z
  recordFormat: fmp4
  recordSegmentDuration: 1h
  recordDeleteAfter: ${KeepDays}d
"@ }
    $yml = @"
# Written by the Burpee Judge streaming installer. Re-run Install.cmd to change.
logLevel: info
logDestinations: [file]
logFile: mediamtx.log
api: false
rtsp: false
hls: false
moq: false

# Phones send here.
rtmp: true
rtmpAddress: :1935
srt: true
srtAddress: :8890

# The judging app watches here.
webrtc: true
webrtcAddress: :8889
webrtcAllowOrigins: ['*']
webrtcLocalUDPAddress: :8189
webrtcIPsFromInterfaces: true
webrtcAdditionalHosts: []

authMethod: internal
$users
$record
paths:
  all_others:
"@
    # without a byte-order mark (Windows PowerShell's UTF8 adds one, which MediaMTX may not read)
    [IO.File]::WriteAllText((Join-Path $InstallDir 'mediamtx.yml'), $yml, (New-Object Text.UTF8Encoding $false))

    # ------------------------------------------------------------------ Tailscale: streaming over the internet
    # A free private network: phones with Tailscale (signed in to the same account) reach this computer from
    # anywhere. Installed with winget (Windows' own package manager); signing in opens the browser.
    if (-not $NoTailscale) {
        Step 'Streaming over the internet (Tailscale)'
        $tsExe = Get-TailscaleExe
        $want = $Tailscale
        if (-not $tsExe -and -not $Tailscale) {
            Write-Host 'Tailscale lets phones stream to this computer from anywhere (4G, another Wi-Fi), not only on this network.'
            $want = (Read-Host 'Set up Tailscale now? It is free for small teams. [Y/n]') -notmatch '^[nN]'
        }
        if (-not $tsExe -and $want) {
            if (Get-Command winget.exe -ErrorAction SilentlyContinue) {
                winget install --id Tailscale.Tailscale -e --silent --accept-source-agreements --accept-package-agreements | Out-Host
                $tsExe = Get-TailscaleExe
            } else {
                Write-Host 'winget is not available here: install Tailscale from https://tailscale.com/download, sign in, then open "Streaming - connection details" again.' -ForegroundColor Yellow
            }
        }
        if ($tsExe -and -not (Get-TailscaleAddress)) {
            Write-Host 'Sign in to Tailscale in the browser window that opens (use the account the phones will use too).'
            Start-Process -FilePath $tsExe -ArgumentList 'up' -WindowStyle Hidden
            foreach ($i in 1..60) { if (Get-TailscaleAddress) { break }; Start-Sleep -Seconds 2 }
        }
        $tsIp = Get-TailscaleAddress
        if ($tsIp) { Write-Host "Tailscale ready: this computer is $tsIp on your Tailscale network." -ForegroundColor Green }
        elseif ($tsExe) { Write-Host 'Tailscale is installed but not signed in yet: sign in, then open "Streaming - connection details" again.' -ForegroundColor Yellow }
    }

    # ------------------------------------------------------------------ firewall
    Step 'Opening the firewall for the local network (and Tailscale)'
    Get-NetFirewallRule -Group $AppName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    $rules = @(
        @{ Name = 'RTMP from phones'; Protocol = 'TCP'; Port = 1935 },
        @{ Name = 'SRT from phones'; Protocol = 'UDP'; Port = 8890 },
        @{ Name = 'WebRTC signalling'; Protocol = 'TCP'; Port = 8889 },
        @{ Name = 'WebRTC video'; Protocol = 'UDP'; Port = 8189 }
    )
    foreach ($r in $rules) {
        New-NetFirewallRule -DisplayName "$AppName - $($r.Name)" -Group $AppName -Direction Inbound -Action Allow `
            -Protocol $r.Protocol -LocalPort $r.Port -RemoteAddress @('LocalSubnet', '100.64.0.0/10') -Profile Any | Out-Null
    }
    New-NetFirewallRule -DisplayName "$AppName - MediaMTX" -Group $AppName -Direction Inbound -Action Allow `
        -Program (Join-Path $InstallDir 'mediamtx.exe') -RemoteAddress @('LocalSubnet', '100.64.0.0/10') -Profile Any | Out-Null

    # ------------------------------------------------------------------ helper scripts and shortcuts
    Step 'Adding start, stop and connection details'
    Copy-Item -Force (Join-Path $PSScriptRoot 'common.ps1') $InstallDir
    Copy-Item -Force (Join-Path $PSScriptRoot 'details.ps1') $InstallDir
    Copy-Item -Force (Join-Path $PSScriptRoot 'uninstall.ps1') $InstallDir
    Set-Content -Path (Join-Path $InstallDir 'start.ps1') -Encoding UTF8 -Value @"
Get-Process mediamtx -ErrorAction SilentlyContinue | Where-Object { `$_.Path -like '$InstallDir*' } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Process -FilePath '$InstallDir\mediamtx.exe' -ArgumentList '"$InstallDir\mediamtx.yml"' -WorkingDirectory '$InstallDir' -WindowStyle Hidden
"@
    Set-Content -Path (Join-Path $InstallDir 'stop.ps1') -Encoding UTF8 -Value @"
Get-Process mediamtx -ErrorAction SilentlyContinue | Where-Object { `$_.Path -like '$InstallDir*' } | Stop-Process -Force
"@
    $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $shell = New-Object -ComObject WScript.Shell
    $desktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
    $links = @(
        @{ Name = 'Streaming - connection details'; Script = 'details.ps1'; Hidden = $true },
        @{ Name = 'Streaming - start server'; Script = 'start.ps1'; Hidden = $true },
        @{ Name = 'Streaming - stop server'; Script = 'stop.ps1'; Hidden = $true }
    )
    if (-not $NoRecording) {
        New-Item -ItemType Directory -Force (Join-Path $InstallDir 'recordings') | Out-Null
        $lnk = $shell.CreateShortcut((Join-Path $desktop 'Streaming - recordings.lnk'))
        $lnk.TargetPath = Join-Path $InstallDir 'recordings'
        $lnk.Save()
    }
    foreach ($l in $links) {
        $lnk = $shell.CreateShortcut((Join-Path $desktop "$($l.Name).lnk"))
        $lnk.TargetPath = $ps
        $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$InstallDir\$($l.Script)`""
        $lnk.WorkingDirectory = $InstallDir
        $lnk.Save()
    }

    # ------------------------------------------------------------------ start at log-in
    Unregister-ScheduledTask -TaskName $AppName -Confirm:$false -ErrorAction SilentlyContinue
    if (-not $NoAutostart) {
        $action = New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$InstallDir\start.ps1`""
        $trigger = New-ScheduledTaskTrigger -AtLogOn
        Register-ScheduledTask -TaskName $AppName -Action $action -Trigger $trigger -Description 'Starts the MediaMTX streaming server for Burpee Judge.' | Out-Null
    }

    # ------------------------------------------------------------------ start and check
    Step 'Starting the server'
    & $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallDir 'start.ps1')
    # (the first start can take a while: Windows checks the new program for viruses)
    $listening = @()
    foreach ($i in 1..20) {
        Start-Sleep -Seconds 1
        $listening = @(1935, 8889) | Where-Object { Get-NetTCPConnection -State Listen -LocalPort $_ -ErrorAction SilentlyContinue }
        if ($listening.Count -ge 2 -or -not (Get-Process mediamtx -ErrorAction SilentlyContinue)) { break }
    }
    if ($listening.Count -lt 2) {
        Write-Host "The server didn't start properly. See $InstallDir\mediamtx.log" -ForegroundColor Yellow
        $log = Join-Path $InstallDir 'mediamtx.log'
        if (Test-Path $log) { Write-Host '--- the end of the log ---'; Get-Content $log -Tail 15 | Out-Host }
        else { Write-Host '--- what MediaMTX says ---'; & (Join-Path $InstallDir 'mediamtx.exe') (Join-Path $InstallDir 'mediamtx.yml') 2>&1 | Select-Object -First 15 | Out-Host }
    } else {
        Write-Host 'Server running.' -ForegroundColor Green
    }

    $page = Write-ConnectionPage $InstallDir $settings
    Start-Process $page
    Write-Host ''
    Write-Host "Done. This computer's address: $(Get-LanAddress)" -ForegroundColor Green
    Write-Host 'The connection details page has opened: give each phone its station''s Larix address.'
} catch {
    Write-Host ''
    Write-Host "Setup failed: $($_.Exception.Message)" -ForegroundColor Yellow
}
Write-Host ''
Read-Host 'Press Enter to close'
