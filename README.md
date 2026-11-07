# HeadJudge and Spartans

Two things share this repository and one Azure home:

- **HeadJudge**: online judging for fitness events. Companies register with their own logo and colours, start a server, film with phones, and judge in any browser.
- **Spartans**: the app and site for Spartan racers (news, chat, scoreboards, Course Run, the burpee challenge).

Everything runs in Azure subscription **HeadJudge** (DEXYS directory, always pass `--subscription 65c0ccca-69f7-43eb-9246-3bd6a6a06b24`).

## How HeadJudge fits together

```
Phones (Broadcaster, Larix)  --RTMP with password-->  the company's server (a graphics-card VM)
                                                       - streaming and recording (MediaMTX)
                                                       - one AI judge per camera (its own Chrome, on the card)
                                                       - review page and API, behind a login (HTTPS by Caddy)
Browser (laptop, iPad)  <--picture over WebRTC, what the judge sees over HTTPS--  the server

The site (Static Web App)  says what's wanted  -->  table  <--  makes it so, every minute  --  control app (Function App)
                                                                                                 only thing with rights over servers
```

| Folder | What it is |
| --- | --- |
| `*.html`, `*.js`, `*.css` at the top | The site and the judge page. `register.*`: company sign-up. `console.*`: a company's start and stop page. |
| `api/` | The site's backend. `companies.js`: registration and brand. `servers.js`: what each company wants its server to do. |
| `server/` | What runs on a company's server. `review/` is the review page. `setup/` prepares a new machine. |
| `control/` | The always-on app that starts and stops servers, and turns off anything that shouldn't be running. |
| `app/`, `scripts/build-app.sh`, `scripts/build-broadcaster.sh` | The Android apps. |
| `promo/` | The animated demo video. |

## Who can do what

A company applies at `register.html` and an admin approves it in `admin.html`. Only then can it start a server, so nobody can run up a bill by signing up.
What people watch is the camera's picture with what its judge on the server sees drawn over it, so judges carry on when the page is closed.
A login link from the site is good for 5 minutes and becomes a 14-hour cookie, signed with a secret only that server and the site hold.

Companies sign in to the website with Google or with an email address. Email accounts are Microsoft Entra External ID, in the tenant `headjudge.onmicrosoft.com`. Microsoft holds the passwords and sends the emails (the code proving an address at sign-up, the code at each sign-in, password reset), so this needs no mail service or DNS. `node scripts/set-up-email-sign-in.mjs` sets it all up and is safe to run again. It asks for one Microsoft sign-in, by code. `email-signin-web.js` draws the buttons, Microsoft comes back to `email-return.html`, and `api/src/email-signin.js` swaps its one-time code for a session. These accounts can't be admins, so the admin area is Google only. The Broadcaster app has no account: it only connects by scanning a camera's code, which only someone signed in to the company's server can see, and the camera password protects the stream itself.

## What keeps the bill down

A company books cameras and hours on `console.html`. Each server takes 2 cameras (a T4 judges two at about 8 frames a second; three fall to about 6), which sets the number of servers and the cost shown. Servers run for the booked time, used or not, then save their recordings and shut down; the booking can be extended. The control app is the backstop: it turns off a server past its booking, one that's stopped reporting (15 minutes), one that didn't come up (25 minutes), and any machine it doesn't recognise.

Recordings are kept for 7 days (`KEEP_DAYS` in `api/src/recordings.js`, the lifecycle rule `recordings-7-days` on the storage account, and `keepDays` on each server). Customers pay per camera, per hour the servers actually run: Azure's server price (the site setting `SERVER_HOUR_PRICE`) shared by its 2 cameras and the cost of storing what's recorded, plus the percentage set in the admin area, `customers.html`. A booking keeps the price it started at. The control app adds up time, cost and charge by the minute. `MAX_RUNNING_SERVERS` must fit the subscription's graphics-card limit (8 vCPUs is one server).
A turned-off server keeps its disk and costs only that. Don't create Azure capacity reservations: they bill the full server rate whether it's used or not.

## Publishing

Tests: `node --test tests/*.mjs`, `cd api && node --test test/*.test.js`, `cd control && node --test test/*.test.js`. The site and API run locally with `node api/dev-server.js 8795`.

```bash
SUB=65c0ccca-69f7-43eb-9246-3bd6a6a06b24; RG=rg-headjudge-uksouth
TOKEN=$(az staticwebapp secrets list --name headjudge -g $RG --subscription $SUB --query properties.apiKey -o tsv)
swa deploy <site folder> --api-location "$(pwd)/api" --api-language node --api-version 20 --env production --deployment-token "$TOKEN"
```

- Server software: `bash scripts/build-server.sh`, then upload `downloads/headjudge-server.tar.gz` to the `downloads` container. Servers fetch it each time they start.
- Control app: `bash scripts/deploy-control.sh`.
- Shared server pieces (network, firewall, image store): `bash scripts/setup-servers.sh`.
- Phone apps: `bash scripts/build-broadcaster.sh`, `bash scripts/build-app.sh`, then upload to the `downloads` container.

Personal test videos (`clips/`, `test.mp4`) stay on this PC: they're never deployed or uploaded. Cloud tests use public footage.

## The judge page

`judge.html` and `app.js` judge from a camera, a stream or a video file. On a server it runs in two modes:

- `?engine=<camera>`: the judge itself, running the models and sending what it sees.
- `?follow=<camera>`: what people watch, playing the same camera and drawing what the judge sent.

Each phone needs internet the **first** time it opens the Spartans app, to download the pose model and number reader (roughly 20 to 30 MB in total).

Judging an uploaded video runs in the viewer's browser, then saves its results to the server. Recordings stay on the server for 14 days and in cloud storage for 30.

---

## Burpee Judge

A phone web app for obstacle-race penalty stations. It reads the athlete's race number, then counts 30 burpees live and counts a rep only when all four race standards are met:

1. Chest to the ground
2. A vertical jump with both feet leaving the ground
3. Full hip extension at the top of the jump
4. Tops of the hands at ear height while jumping (just below is fine)

Each failed rep shows **NO REP** and the reason on screen and is called out by voice. Every attempt is recorded on video, with the bib, count and time burned into the picture, and logged on the phone for CSV export.

## Files

| File | What it is |
|---|---|
| `judge.html`, `styles.css` | The Burpee Judge's screens and race-day styling (`app.html` is the Spartans home page) |
| `app.js` | Camera, race-number scanner, live counting, recording, results |
| `burpee.js` | Burpee rep-judging rules and body measurements. Pure logic, no camera needed |
| `exercises.js` | The exercise list and the judges for squats, push-ups, jumping jacks and sit-ups |
| `pose-filter.js` | Fills in body points hidden behind other parts of the body |
| `multi.js` | Several athletes at once (test): follows each person, zooms in on them, keeps a judge per athlete |
| `finder.js`, `rtmo-s.onnx` | Person finder for several athletes: RTMO-s from OpenMMLab (Apache 2.0, 40 MB), run with ONNX Runtime Web |
| `staticwebapp.config.json` | Lets the host serve the .onnx model file |
| `streaming-setup/`, `burpee-streaming-setup.zip` | Windows installer for the judging computer: downloads and sets up MediaMTX so phones running Larix can stream to it (firewall, start at log-in, a connection details page with each station's Larix address and QR code). Linked from the home screen as "PC streaming setup (Windows)" |
| `ocr-prep.js` | Finds the race number, redraws it level and clean, and splits it into single digits |
| `readers.js` | The three number readers: digit model, PaddleOCR, Tesseract |
| `digit-model.js`, `digit-model.json` | The small digit model and its trained weights |
| `tools/` | Scripts that rebuild the digit model: `python tools/render_digits.py C:/Windows/Fonts train.bin 70`, then the same with `test.bin 12 99`, then `node tools/train_digits.mjs train.bin test.bin` |
| `tests/` | Unit tests: `node --test tests/*.test.mjs` |

Everything runs on the phone: MediaPipe Pose for body tracking and a choice of number readers (Settings → **Number reader**). No server is needed and nothing is uploaded.

## Running it

Phones only allow camera access on **https://** pages, so host the folder on any static host. Netlify Drop, GitHub Pages and Cloudflare Pages all work, and you just upload the folder.

To try it on a laptop webcam, serve it locally (localhost is allowed without https):

```bash
python -m http.server 8791
```

Then open http://localhost:8791.

## Station flow

1. **Open station.** Choose how many burpees each athlete must do (30, or a custom number, which must be filled in), and front camera (the athlete can see the count) or back camera. For a phone standing on its side, pick a landscape option under **Camera orientation** in Settings.
2. **Face the camera.** The app finds the athlete's head (from the body when they stand back, from a face finder when they're close up), and a red box follows their forehead and reads the headband number from there, even while they sway. Nothing outside that box is read, so numbers in the background are ignored. A white strip shows the digits it has picked out. A number is accepted once it's read the same way twice in four tries. **Type number** is the fallback.
3. **Start.** Once the number is read and the athlete is standing tall in full view, the screen shows their number and a big green **START**, and judging begins straight away.
4. **Counting.** Each good burpee steps the count up. Each failed one fills it red with a cross and the reason.
5. **Complete** when the target is reached: a big green tick, then the screen resets to the number scan for the next athlete after 6 s. An attempt the marshal ends early shows a red cross and "Not complete".

With **Capture each athlete's race number** turned off (Settings → Race numbers), step 2 is skipped and athletes are numbered 1, 2, 3 in order at the station.

### Camera station (Spartans app, Android)

Home → Camera station (referees and admins): the phone films a station and streams it to the judging computer and, optionally, to YouTube at the same time, each on its own connection (one encoder, RootEncoder's MultiStream; `app/native/android/StationActivity.java`, opened through the `Station` Capacitor plugin from `camera.html`). No watermark. YouTube goes over RTMPS (RTMP if that fails) with the stream key kept on the phone.

### Judging a phone's stream on a computer

Phones film with Larix and stream to MediaMTX on the judging computer (over the internet, each phone also needs the Tailscale app, signed in to the same account as the judging computer and switched on) (set up with the "PC streaming setup (Windows)" download). On that computer, open the app in Chrome and tap **Judge a phone's stream (PC)**, then give the stream's address from "Streaming - connection details" (the localhost one, e.g. http://localhost:8889/live/station1/whep; browsers block an https page from fetching plain http elsewhere on the network). The app receives the stream over WebRTC (WHEP) and judges it exactly as it would its own camera, recording the evidence video as usual. A dropped stream shows "Stream lost – reconnecting…" and reconnects every few seconds. The phone version of the app is unchanged.

### Several athletes at once (test)

The home screen has two test buttons: **Detailed test with a video** (analyse first, below) and **Real-time test with a video**: the video plays at normal speed and is judged on whatever frames the device keeps up with, exactly as a live camera would be, so it shows how that device would really do at a race (this laptop managed about 9 frames a second on the three-athlete clip, and got it wrong: 2 athletes found instead of 3). The setting below picks what a test does when started from Settings. During a test, a status line shows frames analysed a second, whether the person finder is running (graphics chip, processor, or off) and how many people are in view; the ⟲ and ⟳ buttons turn a video filmed with the phone on its side upright (real-time tests). People in a hi-vis yellow top (officials) are never counted. Athletes do their burpees on one spot, so each one has a home spot (where their hips have been over the last few seconds): followed frame to frame in matching clothes they can go anywhere (walking off at the end), but picked up after being lost, their track only takes a body within about 0.7 of a body height of that spot, so it can't cling to someone walking past or a neighbour; and a newcomer only carries on a missing athlete's count if they turn up on that spot (so after a big camera move an athlete may get a new number). An athlete out of sight for more than 20 seconds has finished and gone: their count stands (dimmed in the list), and nobody who appears later is matched to them or carries it on. When judging as it happens (live, or a real-time test) the extra looks for half-hidden people are rationed (one per frame, a quarter-second apart per person) so the app keeps up; a detailed test does them all. During a test, a bar at the bottom pauses the video and jumps to any point. In a detailed test the picture, counts and list show exactly that moment (sounds of reps jumped over are skipped); in a real-time test, judging carries on from the new point as if the camera had cut there (counts so far stay; reps jumped over are not seen).

Settings → **Uploaded test videos** → **Analyse first, then play at normal speed** (default): the app works through every frame of the video first (15 a second, with a progress bar; nothing is skipped however slow the device), then plays it at normal speed with outlines, counts, the athlete list and the rep sounds appearing as they happened. The wait is about as long as slowed-down playback would take. The other two choices play while analysing: an uploaded video is slowed down until the phone can analyse enough frames to catch every jump (at normal speed on a phone that can't keep up, most jumps are missed: on the three-athlete clip at 6 frames a second, one athlete got 1 rep and 5 "jump" no-reps). **Faster** (default) aims for 10 frames a second, fine for athletes in clear view; **Most accurate** aims for 15, which also picks up an athlete half hidden behind another.

Settings → **Spartan default** sets the race-day setup in one tap: burpees, several athletes at once, no race numbers, strictness 20 (lenient), forgiving body tracking, Full pose model, count called out, video recorded.

Everyone the app is tracking gets a thin grey outline, so you can see they have been picked up; at their first good burpee it turns into their own colour with a number.

Settings → **Athletes in view → Several at once** (the default; **One at a time** is the race-number flow above) counts everyone in view separately, with no race numbers. Opening the station starts counting straight away; each athlete gets a number (1, 2, 3, in the order they start) at their first good rep, a colour of their own, a label in that colour above their head with their count, and a row in the list at the top left. The outline flashes green or red on each rep. Officials and spectators who never complete a rep aren't labelled. **End round** saves one result per athlete, all sharing the round's video.

How it keeps people apart: everyone in view is tracked, athlete or not. Each person is matched to where they were last seen, but only to a body that could really be them a moment later: no further than a person moves in that time (about two body heights a second), no flip between lying and standing within a quarter of a second, and no clearly different clothes. Each track remembers the colour balance of its top (sampled across the torso) and shorts, separately for standing and lying down, and colour weighs in every match; duplicate detections of one person are merged; and a new person whose first rep comes shortly after an unfinished athlete vanished (camera moved, someone walked in front) carries on that athlete's count, unless they were already in view alongside that athlete. People already big in the picture (an official by the camera) are left out of the zoom, and a lost track that never became an athlete is dropped rather than reused, so an official's old track can't take over an athlete. MediaPipe finds people one at a time and often sees two athletes close together as one. So about twice a second a second model, RTMO (finds everyone in one pass, much better at keeping people apart), looks for everyone in the watched area in the background, and anyone it sees that MediaPipe hasn't found gets a zoomed MediaPipe look of their own, with the people found painted over; MediaPipe still does all the judging. RTMO runs on the graphics chip through WebGPU where the browser has it (current Chrome on Android, Safari on iOS 26), otherwise more slowly on the processor; if it cannot load, the app uses painted-over looks instead:  the app takes second looks with everyone already found painted over: twice a second across the watched area (and its left and right parts) for anyone hidden, and, when someone being tracked goes missing, zoomed in on where they were. On a clip of three athletes in a row, this took frames with both of the two remaining athletes found from 5 in 72 to 44, and all three were counted. Second looks cost extra work for the phone. A new athlete found right on top of one already counted and dressed the same is taken as a copy and dropped; someone who walks out of the side of the picture is not carried on by a newcomer. The pose model looks at a zoomed-in part of the frame around the people being tracked, because athletes far from the camera are otherwise found on only a fraction of frames; a second, light model checks the whole frame about once a second for anyone new.

Tested on five race videos (portrait, hand-held, 20–30 m away). One athlete in view, with officials walking past: 23–27 reps on one track each. It struggles when athletes overlap in the picture: two athletes doing burpees in the same spot are often found by the pose model as one body, so they share one number, and the count can carry on on the one who stays after the other leaves. Space athletes apart across the camera view.

Every attempt is saved with full detail: race number and how it was read, start and finish times, camera and settings used, tracking rate, time the athlete was out of view, and for every burpee the result, reasons and what was measured (chest depth, jump height, hip angle, hand height). Tap an attempt in **Results** to see it, or export the **summary** (one row per athlete) and the **rep log** (one row per burpee).

## Number readers

| Reader | Speed per read* | Fake-band test (9 bands) | Notes |
|---|---|---|---|
| **Digit model** (default) | 3–16 ms | 8 read, 0 wrong | 286 KB, trained on 32 fonts. Refuses rather than guesses. |
| **PaddleOCR** | 80–120 ms | 8 read, 0 wrong | 7.5 MB download the first time. |
| **Tesseract** | about 1,100 ms | 8 read, 1 wrong (1310 for 7310 in Impact) | General text reader. |

* Measured on a laptop in a background browser tab, so phones will differ. The scan screen shows the time per read.

The band none of them read correctly used old-style serif figures, where digits sit at different heights. The finder now rejects a number when there's an unread digit-sized mark beside it, so it asks for the number to be typed rather than dropping a digit.

## Body tracking

Settings → **Judging strictness** is one slider for every exercise, from Not strict (0) to Very strict (100). The middle (50) uses the limits as set; either side, every rule's limit for the chosen exercise moves together. Tap "What this changes" under it for details. Each attempt records the value used.

Settings → **Body tracking** decides what happens when part of the body is hidden by another part:

- **Strict:** only points the camera sees clearly are judged.
- **Balanced** (default): a hidden point stays where it was last seen for 0.5 s, then is placed from the matching point on the other side.
- **Forgiving:** the same, for up to 0.9 s, with lower confidence limits.

Chest to the ground takes the lower of two readings: the pose model's 3D estimate and the picture itself (the 3D estimate is rough for athletes far away, and its smoothing can keep it off the floor in a quick burpee).

The burpee jump is measured from the toes when seen, from the heels (which must rise more than tiptoe lifts them) when only they are seen, and from the hips rising above their standing height when the feet are out of shot. "In full view" needs only one shoulder, one hip and one foot, so it works face on or side on. No exercise uses the head: ear level and the top of the head are worked out from the shoulders and hips (0.35 and 0.65 of a torso length above the shoulders). The head is only used to find the race number. Hands over ears is judged from the near hand when the far one is hidden. Guessed points are drawn hollow, with dashed bones. Each attempt records how often points were filled in. The judges also treat a missing reading as unknown instead of out of position, so a moment of hiding doesn't restart a rep.

## Exercises

Settings → **Exercise** picks what the station judges. It starts on **Burpees** and stays on whatever you pick until you change it. The home screen shows a banner whenever it isn't Burpees.

| Exercise | A rep counts when | Start position |
|---|---|---|
| Burpees | Chest to the ground, both feet off in the jump, hips fully extended, hands over the ears | Standing tall |
| Air squats | Hips below the knees at the bottom, then hips and knees straight at the top | Standing tall |
| Push-ups | Elbows past 90° at the bottom, arms locked out at the top, hips kept straight | Plank, arms straight |
| Jumping jacks | Hands above the head and feet wider than the shoulders, then arms down and feet back together | Standing tall |
| Sit-ups | Shoulders back to the ground, then sitting up until the torso is upright | Lying back |
| Hand close (practice) | A fist, then an open hand. A thumbs down is a no rep | Anyone in view |

The only judging control in Settings is the **Judging strictness** slider. The limits it starts from are the defaults in `burpee.js` and `exercises.js`, which haven't been checked against real footage yet. Push-ups and sit-ups need the phone side-on at floor level.

## Course Run (3D game)

`course.html` is a separate section of the site, linked from the home screen, and the judging app doesn't load any of it. It is a playable 3D run of a whole race course on the real terrain.

- **Courses:** Ultra, Beast, Super, Sprint and the three kids' courses from the organisers' route file (`Morzine_UWC_26_V1_1.kmz`). Every obstacle in the file sits on its course in race order. Water stations top up your energy, and marshals, medical points, start and finish arches, penalty loops and the burpee area are all in place.
- **Scenery:** terrain heights come from Copernicus GLO-30. Buildings, forests, roads, rivers, lakes and lift pylons come from OpenStreetMap. Both are cut out of SkiTour's Portes du Soleil 3D pack. The heights are a 30 m grid, smoothed, with the forest canopy taken off.
- **Controls:** the same as SkiTour's play mode.
  - **Phone:** the thumb pad sits bottom right. Left and right steer, forward runs, back slows down and steps back. **Jump** charges while you hold it, and **Sprint** (hold) uses energy.
  - **Keyboard:** arrows or WASD move, Space jumps, Shift sprints, C changes the camera, R resets and Esc pauses.
  - **Steer assist** (on by default) keeps you on the course, and the pad still steers.
  - **Camera:** far, close or first person. Drag to look around; the view eases back after you let go.
- **Obstacles:** each obstacle plays one of 11 mini-games (`course-games.js`), and they get harder the further round the course you are and with the course (Kids, Sprint, Super, Beast, Ultra; shown as Level 1–5):
  - **Skill:** *sequence*, keys in a set order to watch and repeat (multi-ring, Hydra, Armer, Spider); *arrows*, press each as it comes up (Z-wall, Bender); *swing*, the side that lights, in time (monkey bars, ape hanger, Tyrolean).
  - **Strength:** *bash*, tap fast while it slides back (carries, drags, Hercules hoist against the clock).
  - **Climbing and crawling:** left and right in turn on the beat; off the beat and you stall.
  - **Grip:** hold to keep a needle in a wandering band (slip wall, inverted wall, Olympus).
  - **Balance.**
  - **Jumps:** time each hurdle or fire.
  - **Power jump:** for the bell.
  - **Throw:** set the aim, then hold for power and let go in the band; the spear flies at the screen.
  - **Laser:** hit the targets as they light.
  - **Memory:** the board's code is asked at the test.
  - The keyboard works too: arrows and WASD, Space to tap or hold.
- **Official rules:** each mini-game's start screen has a **📖 Official rules** button. It shows what a referee checks at that obstacle (how to complete it, what counts as a fail, and whether it's multiple-attempt, single-attempt or mandatory). These are short summaries in our own words of Spartan's 2026 Rules of Competition (`course-rules.js`), with links to Spartan's official rules page and rulebook PDF. When Spartan updates the rules, update the summaries.
- **Obstacle practice:** an alternative to running a course. On the course page, *Or practise one obstacle* lists every obstacle (Kids ones too). Pick a level (1–5) and an obstacle, and you start 25 m before it. Afterwards it says how you did and offers *Try again* (at any level) or *Another obstacle*.
- **Penalties:** each mini-game starts with what to do and a **Start** button, and you get **5 tries** at each obstacle. After 5 misses:
  - An obstacle with a penalty loop in the file means running that loop there and then.
  - Any other obstacle adds **30 burpees owed**, shown in the HUD. You do them at the next **burpee station**, where the course passes the burpee area in the route file (near the finish; the Ultra passes it twice). Anything still owed is done at the finish line before you can finish.
  - Kids never get penalties.
- **Free running:** steer assist is off by default, so you can run anywhere. An arrow on the ground just ahead points the way along the course, or back to it if you've wandered off: green when you're heading the right way, red (and pulsing) when you're not.
- **Start:** the menu has two pages. First *Your runner*, then *Choose a course*, listed easiest to hardest.
- **Mini-map:** the same drawing as the 2D course map (terrain, roads, numbered and coloured obstacles, water stations), close up and following you with an arrow. Tap it to see the whole course.
- **Carrying:** carry obstacles show the load. A sandbag, log or chain goes on the shoulders, a bucket or atlas stone is hugged to the chest, and a tyre or plate is dragged behind on a rope. Contestants carry them too.
- **Race clock:** it adds real-life time for obstacles, burpees and anything you skip, so the time on the finish card is close to a real race time.
- **People:** the runner, the other contestants, officials and spectators all use one rigged, animated human (three.js's Xbot figure, from Mixamo). It is dressed per person: skin, top (vest, T-shirt or long sleeves) and bottoms (shorts, 3/4 tights or leggings) are coloured in the shader by the bone each part of the body follows. Hair, hats, eyes and the race number are attached to the bones. Obstacle poses (climb, hang, crawl, carry, throw, balance, cheer, burpee) are set by pointing the limbs, on top of the idle, walk and run animations.
- **Your runner:** on the course list you can set the race number, skin, hair and hair colour, hat, top, bottoms and shoes, with a turning 3D preview. Your choices are saved on the device.
- **Company:** contestants start in a wave with you and run at their own pace. They stop at obstacles, and now and then they fail one and do burpees beside the trail. Anyone far ahead or behind drops back in near you. Officials in hi-vis stand at every obstacle and marshal point and turn to watch you go by. Crowds line the tape in town and at the start and finish, cheering, and you can hear them.
- **Rivers** sit in a channel carved about 2 m into the terrain, with muddy, stony banks either side. Where the course crosses a river the ground stays level (a bridge). **No building, lift station or pylon** is drawn on the course: any whose footprint touches it is left out.
- **Look:** ground textures blend meadow and rock by slope. The trail is textured dirt (4.2 m between the tapes), roads are tarmac or gravel, and grass tufts grow around you. Chalets have boards or plaster, windows, shutters and tiled roofs, all drawn in the shader. There are shadows, a sky with the sun, and ACES tone mapping.
- **Weather and time of day:** sunny, light cloud, heavy cloud, mist, rain or thunderstorm, like SkiTour's weather menu, or *changes as you go* (spells drift in and clear every few minutes). The time of day can be morning, midday, afternoon or evening. The 🌦️ button changes the weather mid-run.
- **Course map** (tap a course on the list): a 2D map of the course on shaded terrain with forests, lakes, roads and buildings. It shows every obstacle (numbered and coloured by kind), the water stations, penalty loops and kilometre marks. You can drag, pinch or wheel to zoom, and the obstacle list and height profile jump the map to a spot. From here you can **simulate the course**, which runs it at a fit amateur's pace (Tobler-style slope pace, real time at each obstacle and a stop at every water station) at 30×–600× speed and gives an estimated finish time (Sprint about 1 h, Super about 2 h, Beast about 4 h, Ultra about 9 h). You can also **start from the beginning**, or tap the course to start the 3D run from there. Obstacles before that point are skipped and the contestants start around you.
- **In the 3D run:** **Run** (hold) runs forward without the pad, at a slightly quicker pace than before. Sprinting is switched off for now (`SPRINT` in `course-game.js`). **🤖 Auto** runs the whole course by itself: it completes each obstacle and stops to drink when energy is under 70%. **⏭ Skip** jumps to the next obstacle. During each mini-game the runner acts it out as you play, and finishes it when you pass: over the wall, up and down the A-frame, up the rope to the bell, along the rig, the carry, the crawl, the balance beam, hurdles, the spear throw. Carries, crawls and the hoist slide back if you stop tapping, so you have to bash the button.
- **Energy** goes by distance: a full tank is about 10 km of running on the flat (less uphill), so it always reaches the second water station. Stop at a water station for a second or two to fill it again.
- **Phones:** quality adjusts itself the way SkiTour's does. It drops shadows first, then resolution, then view distance. Trees, buildings and the like are drawn in 500 m tiles, and only tiles in view are drawn. Trees between the camera and the runner are hidden. A run pauses itself when the phone locks.

To rebuild the course pack after the route file or the map data changes, unzip the `.kmz` (a `.kmz` is a zip) and run this, using any SkiTour 3D pack that covers the area:

```bash
node scripts/build-course.cjs doc.kml ../SkiTour/data3d/portes-soleil.json courses/morzine-26.json "Morzine 2026"
```

Credits, also shown in the game: terrain © Copernicus (ESA/Airbus); map data © OpenStreetMap contributors (ODbL); three.js (MIT, `vendor/three.min.js`).

## Spartans home page, chat and apps

| File | What it is |
|---|---|
| `app.html`, `hub.js`, `hub.css` | Spartans home page, at `/app`: the next race with a countdown, latest news, past winners, links to everything, and "Get the app" |
| `chat.html`, `chat.js` | Chat rooms, like SkiTour's notice board (Spartans chat, Morzine 2026, Training, Kit, Lift shares), plus private groups |
| `admin.html`, `admin.js` | Admin: who's banned from the chat and why, with unban |
| `api-base.js` | Where the backend is: `/api`, or the hosted site's `/api` inside the installed app |
| `api/` | The backend: Azure Functions (Node 20), managed by the Static Web App, storing everything in Azure Table Storage (`spartans893191`, table `spartans`). Tests: `cd api; npm test`. Run the site and API locally (in-memory, nothing saved): `node api/dev-server.js`, then open http://localhost:8795 |
| `manifest.webmanifest`, `sw.js`, `icons/` | Lets the site install as an app (iPhone: Safari → Share → Add to Home Screen) and open without signal |
| `app/`, `scripts/build-app.sh` | The Android and iPhone apps (Capacitor) |
| `scripts/make-icons.cjs` | Draws the app icon at every size |

- **Home page content.** Admins edit the race, news and winners on the page itself (the Edit buttons). For the prototype anyone can edit, because the setting `ADMIN_KEY` isn't set. To lock it, set `ADMIN_KEY` on the Static Web App (`az staticwebapp appsettings set ... --setting-names ADMIN_KEY=<secret>`). Admins then put the key in their browser with `localStorage.sp_admin = '<secret>'` until there are proper admin sign-ins. Nothing is pre-filled: the race date, news and winners are for you to add.
- **Upcoming events** (home page): Spartan races with dates, places and races, each with a **Tickets** button to its page on spartan.com, plus a link to Spartan's full race finder. Past events drop off by themselves. The list starts with the European races from uk.spartan.com's race finder (checked 2 November 2026), and admins keep it current with Edit.
- **Chat.** There are no accounts yet. Each phone has a random id (only a hash is stored) and picks a display name.
  - **Public rooms:** swearing and slurs (SkiTour's filter), insults, abuse and threats are refused, and so are links, email addresses and phone numbers. Each phone can send one message every 10 seconds and 60 a day.
  - **Private groups** (＋ Group): make a group and share its 6-letter **join code**, or tap **Invite to group** on someone's message to send them an invite, which they accept or decline next time they open the chat. Only members can read a group. Links and numbers are allowed in groups; rude words are not. The owner can make a new code (the old one stops working). Anyone can leave, and the owner's role passes on.
  - **Self-moderation:** once 3 different people have reported someone in a chat (any of their messages there), they're **banned from that chat** (that room or group, not the others) and their reported messages are hidden.
  - **Admin** (`admin.html`, linked from home): everyone banned, from which chat, when, how many reported them and the messages they were reported for, with **Unban**. It's open to all until `ADMIN_KEY` is set, like the home page editing.
  - Each room keeps its latest 400 messages.
- **Android app.** Run `bash scripts/build-app.sh`; it needs Node, JDK 21 and the Android SDK. It writes `downloads/spartans.apk`, which carries the whole site. Course Run works without signal. The Burpee Judge still downloads its body-tracking models (MediaPipe, ONNX Runtime) from their CDNs, so it needs signal the first time. The chat and news always need a connection. It's a debug-signed build for the prototype. Google Play needs a release build signed with your own key and a Play developer account.
- **iPhone app.** The same script writes `downloads/spartans-ios-project.zip`, the Xcode project. Building it needs a Mac with Xcode (`npm install`, then `npx cap open ios`), and installing it on other people's phones needs an Apple developer account (TestFlight or the App Store). Until then, iPhone users install the web app from Safari.

## Home page, accounts, judges (current)

- **Home** (`app.html`, `hub.js`, at `/app`):
  - **Next race** at the top: the soonest upcoming event, with a countdown, **Take me to the race** (its spartan.com page and tickets) and **All upcoming events**.
  - **Your stats:** race results will come from the linked Spartan profile once Spartan gives access. For now it shows Course Run bests from this phone.
  - The main buttons: **News**, **Past competitions**, **Courses** (`course.html#courses`) and **Connect** (the chat).
  - **Burpee Judge** and **Admin** buttons appear only for judges and admins.
  - The profile button sits at the top right.
  - "Get the app" is hidden inside the Android app and home-screen installs.
- **News** (`news.html`): the organisers' own news (admins edit it), then the latest stories from Spartan's blogs (race stories, training, community, newsroom on shop.spartan.com). They're read by the API from the blogs' Atom feeds and cached for an hour. Spartan posts there rarely: the newest story was from August 2025 when this was built.
- **Past competitions** (`past.html`): each competition's winners per course, with **Play the course** where the Course Run map exists (Morzine 2026). Admins edit it.
- **Courses:** tap a course for its map. In the course view's obstacle list, tap an obstacle for its details, the referee rules summary and **Try this obstacle**. Below it, the other stations (water, medical, timing, burpee station, penalty loops) are listed with their distances.
- **Profile** (`profile.html`):
  - **Sign in with Google** (as SkiTour does; this phone's groups and profile move to the account).
  - Name, racer number, country, age group.
  - **Your Spartan profile:** a link to the person's profile or results on spartan.com, kept for when results can be pulled in. Spartan has no public API for this yet; that would need an arrangement with them.
  - Becoming a **Burpee judge** with the judge code.
- **Burpee judges:** the Burpee Judge (`judge.html`) opens only for judges and admins. Admins switch people's **Burpee judge** on or off on the Admin page (people appear once they've opened their profile or used the chat), or hand out the **judge code** shown there.
- **Settings on the Static Web App:**
  - `GOOGLE_CLIENT_ID`: the Google web client for sign-in; SkiTour's can be reused once this site's address is added to its *Authorised JavaScript origins*.
  - `SESSION_SECRET`: a long random string that signs session tokens.
  - `ADMIN_EMAILS`: comma-separated Google accounts that are admins.
  - `ADMIN_KEY`: optional, an admin key typed on the Admin page.
  - While neither `ADMIN_EMAILS` nor `ADMIN_KEY` is set, everyone is treated as an admin and a judge (the prototype).

## Before using it for prize money

- **Tune the thresholds on real footage.** A test video plays slower when the phone can't analyse 15 frames per second of it, and is judged on the video's own clock, so it's judged the same on any phone. The burpee defaults were set from one real side-on clip of 18 acceptable penalty burpees (17 counted; the last one missed hands over ears by about 1.5 cm). That clip is the middle of the strictness slider: about 10 of 18 pass at 75, 3 at 90 and none at 100. Film some burpees at a real station: good ones, shallow ones, no-jump ones and lazy-arm ones. Load them with **Test with a video file** and switch on **Show measurements on screen** in Settings. Move the strictness slider until the app agrees with a human judge. The defaults are reasoned starting points, not calibrated values.
- **Camera placement matters most.** Use a tripod, put the athlete 3–4 m away and keep the whole body in view, including when lying flat. A slightly angled or side-on view judges chest to ground better than straight-on.
- **Race-number reading is the weakest part.** It copes with tilt up to about 25°, light-on-dark print, mirrored front cameras and background clutter, but creases, mud, glare and curved bands still cause trouble. A wrong number is unlikely, since low-confidence reads are rejected, but "can't read it" will happen. Adding a QR code to wristbands would make this near-perfect. Paste the start list in Settings so only real race numbers are accepted.
- **Keep a human in the loop for disputes.** Every attempt has a video with each rep's time in the CSV, so a marshal can review any claim.
- **Results are stored per phone.** Export the CSV from each phone after the race and combine them. Live results shared across all stations would need a small backend.
