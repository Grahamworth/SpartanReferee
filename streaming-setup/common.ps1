# Shared by install.ps1 and details.ps1: where things live, this computer's
# address on the network, and the connection details page.

$ErrorActionPreference = 'Stop'
$AppName = 'Burpee Judge streaming'
$DefaultInstallDir = Join-Path $env:ProgramData 'BurpeeJudgeStreaming'

# This computer's IPv4 address on the local network: the adapter that has a
# default gateway (the one actually connected), ignoring virtual adapters.
function Get-LanAddress {
    $configs = Get-NetIPConfiguration -ErrorAction SilentlyContinue |
        Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' -and $_.InterfaceDescription -notmatch 'Hyper-V|VirtualBox|VMware|WSL|Loopback|TAP|VPN' }
    foreach ($c in $configs) {
        foreach ($a in $c.IPv4Address) {
            if ($a.IPAddress -and $a.IPAddress -notlike '169.254.*') { return $a.IPAddress }
        }
    }
    # Fallback: any private IPv4 address.
    $any = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' } |
        Select-Object -First 1
    if ($any) { return $any.IPAddress }
    return '127.0.0.1'
}

# This computer's Tailscale address (100.x.y.z), if Tailscale is installed and signed in: phones running
# Tailscale can stream to it from anywhere (4G, another Wi-Fi), not only on the same network.
function Get-TailscaleExe {
    foreach ($p in @("$env:ProgramFiles\Tailscale\tailscale.exe", "${env:ProgramFiles(x86)}\Tailscale\tailscale.exe")) { if ($p -and (Test-Path $p)) { return $p } }
    $cmd = Get-Command tailscale.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}
function Get-TailscaleAddress {
    $exe = Get-TailscaleExe
    if ($exe) {
        try { $ip = (& $exe ip -4 2>$null | Select-Object -First 1); if ($ip -match '^100\.') { return $ip.Trim() } } catch { }
    }
    $a = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -match '^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.' } | Select-Object -First 1
    if ($a) { return $a.IPAddress }
    return $null
}

# Reads the settings saved at install (stations, publish password).
function Read-Settings($dir) {
    $file = Join-Path $dir 'settings.json'
    if (Test-Path $file) { return Get-Content $file -Raw | ConvertFrom-Json }
    return $null
}

# The page phones and the judging app need: one card per station with the
# Larix addresses (RTMP and SRT, with QR codes), a link to watch the stream,
# and the address to give the Burpee Judge app on this computer.
function Write-ConnectionPage($dir, $settings) {
    $ip = Get-LanAddress
    $ts = Get-TailscaleAddress
    $cards = foreach ($n in 1..$settings.Stations) {
        # Larix wants an RTMP address in two parts (app/stream), so each station is live/stationN
        $name = "live/station$n"
        if ($settings.Password) {
            $rtmp = "rtmp://${ip}:1935/${name}?user=larix&pass=$($settings.Password)"
            $srt = "srt://${ip}:8890?streamid=publish:${name}:larix:$($settings.Password)"
        } else {
            $rtmp = "rtmp://${ip}:1935/${name}"
            $srt = "srt://${ip}:8890?streamid=publish:${name}"
        }
        # A Larix Grove link: scanning it opens Larix and adds the connection with these video settings
        # (an iPhone's camera opens it straight away; on Android use a QR scanner app, or Larix's own Grove import)
        $grove = 'larix://set/v1?conn[][url]=' + [uri]::EscapeDataString($rtmp) + '&conn[][name]=' + [uri]::EscapeDataString("Burpee Judge station $n") +
            '&conn[][mode]=va&enc[vid][res]=1280x720&enc[vid][fps]=30&enc[vid][bitrate]=3500'
        $groveHtml = [System.Net.WebUtility]::HtmlEncode($grove)
        $whep = "http://localhost:8889/${name}/whep"
        # the same over Tailscale (from anywhere)
        $tsBlock = ''
        if ($ts) {
            $tsRtmp = $rtmp.Replace("rtmp://${ip}:", "rtmp://${ts}:")
            $tsGrove = 'larix://set/v1?conn[][url]=' + [uri]::EscapeDataString($tsRtmp) + '&conn[][name]=' + [uri]::EscapeDataString("Burpee Judge station $n (internet)") +
                '&conn[][mode]=va&enc[vid][res]=1280x720&enc[vid][fps]=30&enc[vid][bitrate]=2500'
            $tsGroveHtml = [System.Net.WebUtility]::HtmlEncode($tsGrove)
            $tsBlock = @"
  <div class="row">
    <div class="qrbox"><div class="qr" data-text="$tsGroveHtml"></div><p>Scan with the phone (Tailscale on)</p></div>
    <div>
      <h3>Larix link over the internet (phone on 4G or any Wi-Fi, with Tailscale on)</h3>
      <code><a href="$tsGroveHtml">$tsGroveHtml</a></code>
      <h3>RTMP address over the internet</h3>
      <code>$tsRtmp</code>
      <h3>Burpee Judge app on this computer: stream address</h3>
      <code>$whep</code>
    </div>
  </div>
"@
        }
        $view = "http://${ip}:8889/${name}"
        @"
<section class="card">
  <h2>Station $n</h2>
$tsBlock
  $(if ($ts) { '<details class="lan"><summary>Same Wi-Fi as this computer instead</summary>' })
  <div class="row">
    <div class="qrbox"><div class="qr" data-text="$groveHtml"></div><p>Scan to add it to Larix</p></div>
    <div>
      <h3>Larix link (adds this station to Larix)</h3>
      <code><a href="$groveHtml">$groveHtml</a></code>
      <h3>Larix: RTMP (simplest)</h3>
      <code>$rtmp</code>
      <h3>Larix: SRT (better over 4G)</h3>
      <code>$srt</code>
      <h3>Watch the stream (any browser on this network)</h3>
      <code><a href="$view" target="_blank">$view</a></code>
      <h3>Burpee Judge app on this computer: stream address</h3>
      <code>$whep</code>
    </div>
  </div>
  $(if ($ts) { '</details>' })
</section>
"@
    }
    $when = Get-Date -Format 'dd/MM/yyyy HH:mm'
    # with Tailscale, every phone needs the Tailscale app too: say so first and loudly
    $mustBlock = ''
    if ($ts) {
        $mustBlock = @"
<section class="must">
  <h2>First, on EVERY phone: install Tailscale (as well as Larix)</h2>
  <p>The internet address <strong>$ts</strong> only works on devices running Tailscale. Without it Larix says <strong>"Can't connect to server"</strong>.</p>
  <ol>
    <li>Install <strong>Tailscale</strong> from the Play Store / App Store.</li>
    <li>Open it and sign in with the <strong>same account</strong> as this computer. Allow the VPN when the phone asks.</li>
    <li>Check it says <strong>Connected</strong> and this computer is in its device list. Turn off any other VPN on the phone.</li>
    <li>Test: in the phone's browser open <strong>http://${ts}:8889/live/station1</strong>. "Stream not found" means it can reach this computer. Doesn't load: Tailscale isn't connected, or this computer's firewall is blocking it.</li>
    <li>Leave Tailscale switched on whenever the phone is streaming.</li>
  </ol>
</section>
"@
    }
    $html = @"
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Streaming connection details</title>
<style>
  :root { --red: #e2231a; --bg: #0b0b0b; --ink: #161616; --fg: #fff; --muted: #b5b5b5; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.45 system-ui, Segoe UI, Arial, sans-serif; }
  main { max-width: 980px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { margin: 0 0 4px; font-size: 2rem; text-transform: uppercase; font-style: italic; letter-spacing: .02em; border-bottom: 4px solid var(--red); padding-bottom: 8px; }
  .meta { color: var(--muted); margin: 8px 0 20px; }
  .card { background: var(--ink); border-top: 4px solid var(--red); padding: 16px; margin: 0 0 18px; }
  .card h2 { margin: 0 0 10px; text-transform: uppercase; }
  .card h3 { margin: 12px 0 4px; font-size: .9rem; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
  .row { display: flex; gap: 18px; flex-wrap: wrap; align-items: flex-start; }
  .row > div:last-child { flex: 1; min-width: 260px; }
  code { display: block; background: #000; padding: 8px 10px; overflow-wrap: anywhere; user-select: all; }
  a { color: #fff; }
  .qr { background: #fff; padding: 8px; width: 216px; height: 216px; }
  details.lan { margin-top: 14px; border-top: 1px dashed #333; padding-top: 10px; }
  details.lan summary { cursor: pointer; color: var(--muted); }
  details.lan .row { margin-top: 12px; }
  .row.ts { margin-top: 16px; padding-top: 14px; border-top: 1px dashed #333; }
  .qrbox p { margin: 6px 0 0; color: var(--muted); font-size: .85rem; text-align: center; }
  .tips { background: var(--ink); padding: 16px; }
  .must { background: #3a0d0b; border: 2px solid var(--red); padding: 16px; margin: 0 0 18px; }
  .must h2 { margin: 0 0 8px; }
  .must li { margin: 6px 0; }
  .tips li { margin: 6px 0; }
</style></head><body><main>
<h1>Streaming connection details</h1>
<p class="meta">This computer: <strong>$ip</strong> &middot; made $when &middot; if this computer's network changes, open "Connection details" again to refresh the addresses.</p>
$mustBlock
<section class="tips">
  <strong>Then set up Larix on each phone</strong>
  <ol>
    <li><strong>Scan the station's QR code</strong> with the phone: it opens Larix and adds the station (with the video settings below). On an <strong>iPhone</strong> the camera app does it. On <strong>Android</strong> the camera often can't open app links: use a QR scanner app (e.g. Google Lens's "open link"), or send the Larix link to the phone and tap it.</li>
    <li>Or by hand: Larix &rarr; Settings &rarr; Connections &rarr; New connection, paste the station's RTMP address as the URL and give it the station's name.</li>
    <li>Settings &rarr; Video: <strong>H.264</strong>, <strong>1280&times;720</strong>, <strong>30 fps</strong>, bitrate about <strong>3&ndash;4 Mbps</strong>, keyframe interval <strong>1&ndash;2 s</strong>.</li>
    <li>On the same Wi-Fi as this computer (or its hotspot): use the station's first QR code.</li>
    <li>Anywhere else (4G, a different Wi-Fi): $(if ($ts) { "with <strong>Tailscale on and connected on the phone</strong> (see the red box above), use the station's QR code. This computer's Tailscale address: <strong>$ts</strong>." } else { "Tailscale isn't set up on this computer. Run Install again and choose to set it up (or install it from tailscale.com, sign in, then open Connection details again)." })</li>
    <li>Tap the red button to start streaming, then open "Watch the stream" below on this computer to check it arrives.</li>
  </ol>
</section>
$($cards -join "`n")
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>
  for (const el of document.querySelectorAll('.qr')) {
    if (window.QRCode) new QRCode(el, { text: el.dataset.text, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.L });
    else el.textContent = 'QR codes need an internet connection; copy the address instead.';
  }
</script>
</main></body></html>
"@
    $page = Join-Path $dir 'connection-details.html'
    Set-Content -Path $page -Value $html -Encoding UTF8
    return $page
}
