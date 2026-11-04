BURPEE JUDGE STREAMING SERVER
=============================

Sets up MediaMTX (free, open source) on the computer that does the judging,
so phones running Larix can stream to it.

INSTALL (on the judging computer)
1. Copy this folder onto the computer.
2. Double-click Install.cmd. Windows asks to allow changes: say Yes (it's
   for the firewall rules).
3. It downloads MediaMTX from its official GitHub page, checks it, sets it
   up, starts it, and opens the "Connection details" page.

It needs an internet connection the first time (for the download).

WHAT IT SETS UP
- MediaMTX in C:\ProgramData\BurpeeJudgeStreaming
- Phones send to it by RTMP (port 1935) or SRT (port 8890), with a name
  and password (shown on the connection details page; kept if you
  re-install).
- The Burpee Judge app watches over WebRTC (ports 8889 and 8189).
- Windows Firewall: those ports opened for the local network only.
- It starts automatically when you log in.
- Desktop shortcuts: "Streaming - connection details", "Streaming - start
  server", "Streaming - stop server", "Streaming - recordings".
- A recording of every station, in
  C:\ProgramData\BurpeeJudgeStreaming\recordings\live\stationN (one .mp4
  file per hour, deleted after 14 days; about 1.5 GB an hour per station).

PHONE APP: SPARTANS APP (RECOMMENDED) OR LARIX
- Spartans app (Android): home > Camera station. Scan the station's QR code
  on the connection details page, optionally add a YouTube stream key, then
  GO LIVE. It streams to this computer and to YouTube at the same time, each
  on its own connection, with no watermark. Tailscale is still needed on the
  phone for the judging computer (not for YouTube).
- Larix Broadcaster (Android/iPhone): as below. The free version adds a
  "TEST STREAM" watermark.

EACH PHONE NEEDS TWO APPS: LARIX AND TAILSCALE
To stream over the internet (the usual setup), every phone needs Tailscale
installed, signed in to the SAME account as the judging computer, and switched
on. Without it Larix says "Can't connect to server". See STREAMING FROM
ANYWHERE below; do that first.

LARIX ON EACH PHONE
1. Open "Streaming - connection details" on the computer.
2. Scan the station's QR code with the phone: it opens Larix and adds the
   station with the right video settings. iPhone: the camera app does it.
   Android: the camera often can't open app links, so use a QR scanner app
   (or Google Lens) and open the link, or send the "Larix link" to the phone
   and tap it. By hand instead: Larix > Settings > Connections > New
   connection, paste the station's RTMP address and name it.
3. Settings > Video: H.264, 1280x720, 30 fps, about 3-4 Mbps, keyframe
   interval 1-2 s.
4. The phone must have Tailscale on and connected (internet), or be on the
   same network as the computer (same Wi-Fi, or the computer's hotspot).
5. Start streaming, then use "Watch the stream" on the page to check it.

STREAMING FROM ANYWHERE (TAILSCALE)
When the phones can't be on the same Wi-Fi as the computer, Install offers to
set up Tailscale (free): a private network between your own devices.
1. On the computer: say Yes when Install asks, and sign in in the browser.
2. On EACH phone (required, as well as Larix): install the Tailscale app
   from the Play Store / App Store, sign in with the SAME account as the
   computer, allow the VPN, and check it says Connected and the computer is
   in its device list. Turn off any other VPN. Leave it on while streaming.
   Test: in the phone's browser open http://<computer's 100.x address>:8889/live/station1
   "Stream not found" = it works. Doesn't load = Tailscale not connected or
   the computer's firewall is blocking it.
3. In Larix use the station's "From anywhere" QR code / link (it uses the
   computer's Tailscale address, 100.x.y.z).
Works over 4G or any Wi-Fi. If the phone and computer can't connect directly,
Tailscale relays the video, which can lower the quality; the "From anywhere"
link asks Larix for a slightly lower bitrate for that reason.

If the computer joins a different network its address changes: open the
connection details shortcut again for the new addresses.

OPTIONS (run from PowerShell in this folder)
  .\install.ps1 -Stations 6      list 6 stations instead of 4
  .\install.ps1 -NoPassword      phones can publish without a password
  .\install.ps1 -NoAutostart     don't start at log-in
  .\install.ps1 -Tailscale       set up Tailscale without asking
  .\install.ps1 -NoTailscale     don't offer Tailscale

REMOVE
Double-click Uninstall.cmd: stops the server and removes it, its firewall
rules, start-up task and shortcuts.

OPTIONS FOR RECORDINGS
  .\install.ps1 -NoRecording     don't keep recordings
  .\install.ps1 -KeepDays 30     keep recordings for 30 days

TROUBLESHOOTING
- Larix says "Can't connect to server" on the internet link: Tailscale isn't
  installed, signed in (same account) or connected on the phone.
- Nothing arrives from the phone: check the phone and computer are on the
  same network, and the address on the page is current. The server's log is
  C:\ProgramData\BurpeeJudgeStreaming\mediamtx.log
- Guest or event Wi-Fi often stops devices talking to each other. Use the
  computer's hotspot, or a small router of your own.
