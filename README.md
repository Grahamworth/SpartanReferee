# SpartanReferee

SpartanReferee was copied from HeadJudge (github.com/Grahamworth/HeadJudge, `C:\Repo\HeadJudge`) on 18 November 2026, with its history, to be developed separately. It is fully separate: its own website (https://brave-forest-022879f03.3.azurestaticapps.net), API data, storage (`spartanreferee`), control app (`spartanreferee-control`), server network, firewall and image store (`rg-spartanreferee-servers`), Microsoft sign-in app (`SpartanReferee`, VDASO directory) and email sign-in directory (`spartanreferee.onmicrosoft.com`). Its resource groups are `rg-spartanreferee-uksouth` and `rg-spartanreferee-servers`, in the HeadJudge subscription. Servers are named `sr-…`. It shares that subscription's GPU limit with HeadJudge: 40 vCPUs in Italy North, 5 servers at once across both. Nothing here changes HeadJudge, and HeadJudge's changes don't reach here. The code is at github.com/Grahamworth/SpartanReferee (private).

Sign-in is **Microsoft only** (from 18 November 2026): the website offers no Google or email buttons, and the site has no `GOOGLE_CLIENT_ID` or `CIAM_*` settings, so the API refuses both (503). Admins need an address Microsoft vouches for. Local testing (`node api/dev-server.js`) has a "Sign in (test account)" button instead. The email directory `spartanreferee.onmicrosoft.com` and `scripts/set-up-email-sign-in.mjs` are still there but unused.

Its look (from 18 November 2026) is Spartan's: the name SpartanReferee on every page, red `#e2231a` on black, and the Spartans helmet (white on a red disc) as its icon, drawn by `node scripts/make-icons.cjs icons/spartanreferee`. A company's own logo and colours still replace it on its pages, as before. The Broadcaster app is "SpartanReferee Broadcaster" (`com.vdaso.spartanreferee.broadcast`), so it installs beside HeadJudge's rather than replacing it. Code names (`headjudge.css`, `HeadJudgeBrand`, `headjudge-server.tar.gz`, the server's `headjudge` services) are unchanged.

### One organisation: Spartan's referees

There's no registration, no customers and no card (from 18 November 2026). SpartanReferee is one built-in organisation, `spartan` (`api/src/companies.js`), and who's in it is decided in the admin area (`customers.html`):

- **Referees**: an admin adds the address each referee signs in with (Microsoft has to vouch for it). Anyone else who signs in is told to ask an admin. Taking someone off the list locks them out at once.
- **Admins**: `ADMIN_EMAILS` (permanent) plus those added in the admin area. Admins are in without being on the referees list; they add and remove referees and admins, and can stop the servers.
- Everyone in books, starts, extends and stops the servers from the console, with no payment step (`freeBooking` in `api/src/servers.js`), within the shared limit of 5 servers. Recordings and results belong to the organisation, so every referee sees them.
- `register.html` only sends old links to the console. The admin page shows this month's Azure cost and camera hours, not prices or profit.

### Events, training and testing

Referees book cameras for something (`api/src/servers.js`, "units"), and each has its own booking and servers, so two events on the same weekend don't block each other (within the shared limit of 5 servers):

- **A Spartan event**: the burpee camera station, from 07:00 to 18:00 local time on each of its days (`EVENT_DAY` in `api/src/events.js`). Booking now is only possible during those hours, and a booking or extension stops at 18:00. The event's **head referee** (assigned on the admin page) books, extends and stops it, and admins can too; every referee can open it to watch Live, the Cameras and the Results (from 19 November 2026). An admin can tick "Any time" to ignore the event's hours.
- **Practice**: every referee practises with the **free camera** (`/review-free/`, HeadJudge's in-browser judge: no server, no cost), linked from the last lesson of Learning's **Burpee camera station** course.
- **Training** (a real server, to rehearse the station): head referees and admins only (from 19 November 2026), 30 minutes, any time, can't be extended. Each has their own. Booked only from that same lesson (`/learn/#/programmes/camera-station`, `POST /api/learn/practice-camera`); the console refuses it and lists it only while it's booked, so it can be watched there.
- **Testing**: admins only, any time, as bookings always were. Each admin has their own.

The events come from Spartan's own race list (`api/src/events.js`): the list its "Find a race" page uses (`api-gate.eks.spartan.com/one/v2/races/upcoming`), with each race's timezone from another of Spartan's services (`api2.spartan.com/api/races/upcoming_past_planned`) where it has it, else from the country (and the longitude in countries with several timezones). Neither is a published API, so the sync can break if Spartan changes them: the last good copy is kept, and the admin page says when it last worked and has **Sync now**. It syncs when the copy is more than 6 hours old and someone opens the console or the event list. An event Spartan stops listing stays until a week after it ends (one of Spartan's lists has been seen to leave out the next few weeks' races). Ask Spartan for permission or an official feed before relying on it.

### Home page, assigned events and learning

Signing in leads to each person's home page (`home.html`, from 19 November 2026; data from `GET /api/home` in `api/src/assignments.js`): their name, the upcoming events they're assigned to (each marked head referee or referee), and the ways to **Learning** (`/learn`) and **Cameras** (the console). Admins also get **Admin**.

Tapping an event opens its page (`event.html?id=<event id>`, `GET /api/event/<id>`): its dates and place, its burpee cameras (**Book the burpee cameras** for its head referee and admins, **See the booking**, or once they're on **Watch live** for everyone, all on the console: `console.html?unit=e<event id>`), who's refereeing it (head referees first, by the name they signed in with), each day's camera hours in local time and the viewer's own, and Spartan's page for it. Any referee can open any event's page.

Admins assign referees to events on the admin page ("Who's refereeing each event"), as **head referee** or **referee**, and can switch either way: anyone on the referees list, or an admin. An event can have more than one head referee. An event's head referee books and runs its burpee cameras (admins can too); every referee can watch them and review the results. An assignment stays until it's removed; it stops showing once the event is over.

The learning platform (`/learn`, `api/src/learn`) is open to everyone in the organisation (admins only before 19 November 2026). Someone's first visit makes their record there with just their name and address: an admin's as a global admin, a referee's as a learner with no other role. Anyone taken off the referees list loses it at once too. Apart from those real records, everyone in it is invented. Its database pauses after an hour unused; the first visit after that wakes it, which can take up to a minute (the API tries for about 30 seconds, then asks to try again in a minute).

### The learning platform (/learn)

Spartan's Learning & Competence Platform prototype (from their requirements v0.2): one profile, any number of programmes, lessons with narration and a Spanish pilot, assessments with assessors, demonstration credentials, versioned rule references with review items, a handbook PDF, reports and a read API. It has its own Azure SQL database and its own documentation: [docs/learning/README.md](docs/learning/README.md) (setup, demo people, tests), [architecture](docs/learning/architecture.md), [decisions](docs/learning/decisions.md), [read API](docs/learning/api.md), [acceptance tests](docs/learning/acceptance.md) (all 12 pass) and [backlog](docs/learning/backlog.md).

### The installable app (offline)

Added 19 November 2026. Home and Learning install as an app: Android and desktop Chrome or Edge offer **Install** on the home page, and on an iPhone the card explains Share → Add to Home Screen. `manifest.webmanifest` opens the app on `home.html`. The service worker `sw.js` keeps Home and Learning's own files: it takes them from the network when there's signal and from its copy when there isn't, and leaves the API and the camera pages alone. Any other page opened offline shows `offline.html`. `scripts/deploy-site.sh` stamps the commit into `sw.js`, so each deploy refreshes the phone's copy.

What the server says is kept by the pages, in `offline.js` (Cache Storage `sr-data`):
- Every Learning answer is kept as it arrives. Copies belong to the signed-in person: another sign-in on the same phone can't read them, and **Sign out** deletes them.
- With no signal, or no answer within 8 seconds, the page shows the kept copy, and a bar says which and from when.
- On a programme's page, **Save for offline** (`learn/saved.js`) fetches every lesson in the page's language, the rules, the handbook and the PDF maker. It also fetches each slide's Azure narration, passed through the API (`…/narration/<slide>?file=1`) because the storage account has no CORS setting. Saving the camera course takes about 2 MB, and narration that wasn't saved falls back to the device's own voice.
- Lesson progress and completion made offline wait in an outbox and are sent when there's signal again. Anything else that changes data says it needs a connection.
- Assessments stay online only.

### Keeping sharp: quick checks, refreshers, streak and badges

Added 19 November 2026. The server side is `api/src/learn/checks.js` (migration `006-checks.sql`) and the pages are in `learn/sharp.js`. All of it is practice: none of it counts towards a credential, which only the assessment gives.
- **Quick check:** every lesson ends with 2 or 3 questions on what it just taught: 84 questions in all, in `scripts/learn-checks.json`. Claude wrote them from each lesson's own slides, keeping clear of the exam's questions. A lesson is marked complete once its check is answered, right or wrong. Each answer is marked at once, with a short explanation and links to the rules it's about.
- **Refreshers:** answered questions come back as refreshers, 5 at a time. Each right answer moves a question to a longer gap (1, 3, 7, 21, 60, then 120 days) and a wrong one sends it back to 1 day. A question comes back at once if a rule it cites gets a new approved version. Learning's overview and each programme's page show what's due. Home suggests a refresher when an assigned event is less than 10 days away.
- **Streak:** it counts weeks, not days, because referees train between events.
- **Badges:** per programme there are First lesson, Halfway, All lessons done, Sharp eye (every quick check right) and Qualified. Overall there are four and twelve weeks running, and five refreshers. Badges are kept once earned. There's no leaderboard.
- **Offline:** quick-check and refresher answers made offline wait in the outbox, like lesson progress.
- **Data:** practice, the streak and badges are in a person's data export and are deleted when they're erased.

**The study look** (`study.css`, `look.js`): Home, Learning and the offline page are calmer than the event-day pages.
- **Light or dark:** it follows the phone, or the **Look** button in the header.
- **Colours:** Spartan red is kept for the header line and the name, actions are blue, and red and green only ever mean wrong and right.
- **Text:** headings are in sentence case, not italic capitals, and cards are rounder.

The camera, judge and admin pages keep the original black and red look.

### Languages

Every page, the judge, the server's video review and the Broadcaster app come in English, French, German, Dutch, Spanish, Italian, Greek, Croatian, Czech, Polish, Finnish, Swedish, Danish, Arabic (right to left) and Thai, for the World Championships (France, Greece, Croatia, UAE, Finland, Thailand), next year's Euros (Netherlands) and the rest. The language is the browser's, or the one picked in the menu at the top (remembered), and the console opens a server's review in it. The translations were made by Claude, not checked by native speakers yet: check each before an event in that country.

How it works: pages stay written in English, and `i18n.js` translates what's on screen as it appears, from `i18n/<code>.json`, keyed by the English text. Results, no-rep reasons and what the judge sends the server stay English; what's spoken and drawn on the review's video is translated. The recorded evidence video's caption stays English. After changing any text people see:

```bash
node scripts/i18n-mark.mjs      # a new sentence with a link or bold words in it is marked to translate whole
node scripts/i18n-extract.mjs   # i18n/en.json, the list to translate (a test fails until it's up to date)
node scripts/i18n-extract.mjs --check   # what each language is missing; node scripts/i18n-check.mjs <code> for one
```

A text with no translation shows in English, so nothing breaks while a language catches up.

**The learning platform and each referee's language** (19 November 2026): /learn is translated the same way, including the server's messages and the programmes' titles, summaries and questions (`contentTexts()` in the extractor reads them from the seed data). The lessons themselves are content versions in each language, so they keep their own approval state: every lesson is in all 15 languages, the 14 translations machine-made by Claude and published for the demo with "Claude (machine translation), not yet reviewed" as their translator (`scripts/learn-translations/<code>.json`, loaded by `learn-seed.mjs`). Each language has its own narration voice. A referee chooses their language on their first visit (Home or Learning); it's kept with them (`/api/home`), so a new device and their lessons use it, and changing the menu at the top saves it straight away. The handbook PDF is drawn by jsPDF in the Western European languages and by the browser's print (Save as PDF) in the others, whose letters jsPDF's fonts can't draw. Native speakers should review the lessons before real use; Spartan's officiating terms (Head Official, Race Director) were chosen by each translator where the site had none.

What follows was written for HeadJudge, before the rename.

## HeadJudge, as copied

Online judging for fitness events. Companies register with their own logo and colours, start a server, film with phones, and judge in any browser.

The Spartans app and site for Spartan racers were split out on 8 November 2026 into their own repository (`Grahamworth/Spartans`), with their own site, backend and data in the VDASO subscription. HeadJudge keeps its own copy of the AI judge (`judge.html`, `app.js`, `burpee.js` and the rest), which the Spartans copy no longer shares.

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
| `app/`, `scripts/build-broadcaster.sh` | The Broadcaster Android app (`app/native/android` is its camera screen). |
| `promo/` | The animated demo video. |

## Who can do what

(As copied from HeadJudge: companies registered and were approved. SpartanReferee replaced that with one organisation, above.)
What people watch is the camera's picture with what its judge on the server sees drawn over it, so judges carry on when the page is closed.
A login link from the site is good for 5 minutes and becomes a 14-hour cookie, signed with a secret only that server and the site hold.

Companies sign in to the website with Google or with an email address. Email accounts are Microsoft Entra External ID, in the tenant `headjudge.onmicrosoft.com`. Microsoft holds the passwords and sends the emails (the code proving an address at sign-up, the code at each sign-in, password reset), so this needs no mail service or DNS. `node scripts/set-up-email-sign-in.mjs` sets it all up and is safe to run again. It asks for one Microsoft sign-in, by code. `email-signin-web.js` draws the buttons, Microsoft comes back to `email-return.html`, and `api/src/email-signin.js` swaps its one-time code for a session. These accounts can't be admins, so the admin area is Google and Microsoft only.

They can also **Sign in with Microsoft**, with any work, school or personal Microsoft account. The app "HeadJudge" is registered in VDASO's directory, so Microsoft's screen shows it as coming from vdaso.com. `node scripts/set-up-microsoft-sign-in.mjs` sets it up and gives the site `MICROSOFT_CLIENT_ID`. It comes back to the same `email-return.html`, and `api/src/microsoft-signin.js` swaps the code for a session. A Microsoft address counts for admin rights only when Microsoft vouches for it: a personal account's own address, or a work address whose domain its organisation has proved it owns.

Every page with an account has **Sign out** at the top right (`api-base.js` adds it), and so does the video review on each server, where it ends that browser's session on the server. The Broadcaster app has no account: it only connects by scanning a camera's code, which only someone signed in to the company's server can see, and the camera password protects the stream itself.

## What keeps the bill down

A company books cameras and hours on `console.html`. Each server takes 2 cameras (a T4 judges two at about 8 frames a second; three fall to about 6), which sets the number of servers and the cost shown. Servers run for the booked time, used or not, then save their recordings and shut down; the booking can be extended. The control app is the backstop: it turns off a server past its booking, one that's stopped reporting (15 minutes), one that didn't come up (25 minutes), and any machine it doesn't recognise.

Each server also saves its athletes, tracking and numbers to cloud storage, so `results.html` can show a company's past week, to search, watch and download, whether or not a server is on. Recordings are kept for 7 days (`KEEP_DAYS` in `api/src/recordings.js`, the lifecycle rule `recordings-7-days` on the storage account, and `keepDays` on each server). Customers pay per camera, per hour the servers actually run: Azure's server price (the site setting `SERVER_HOUR_PRICE`) shared by its 2 cameras and the cost of storing what's recorded, plus the percentage set in the admin area, `customers.html`. A booking keeps the price it started at. The control app adds up time, cost and charge by the minute. `MAX_RUNNING_SERVERS` must fit the subscription's graphics-card limit (8 vCPUs is one server).
A shut-down server is deleted with its disk and address once it has said everything is in cloud storage (`control/src/reconcile.js`), or after a week regardless, so it costs nothing between bookings. Its camera settings stay with the site (`servers/settings`), and each new server has a new address, as certificate authorities limit how often one address can be issued for, so its QR codes change with each booking. Don't create Azure capacity reservations: they bill the full server rate whether it's used or not.

## Publishing

Tests: `node --test tests/*.mjs`, `cd api && node --test test/*.test.js`, `cd control && node --test test/*.test.js`, and the learning database's (`source scripts/learn-env.sh && cd api && npm run test:sql`, in the `learn_test` schema). The site and API run locally with `node api/dev-server.js 8795`.

```bash
bash scripts/deploy-site.sh   # the files in scripts/site-files.txt, plus the media in site-extras/ (kept on this PC, not in git)
```

- Server software: `bash scripts/build-server.sh`, then upload `downloads/headjudge-server.tar.gz` to the `downloads` container. Servers fetch it each time they start.
- Control app: `bash scripts/deploy-control.sh`.
- Shared server pieces (network, firewall, image store): `bash scripts/setup-servers.sh`.
- Broadcaster app: `bash scripts/build-broadcaster.sh`, then upload `downloads/spartans-broadcaster.apk` to the `downloads` container.

`deploy-site.sh` refuses to run with uncommitted site or API files, applies any new learning-database migrations (`scripts/learn-migrate.mjs`), writes `/version.json` with the commit and time, and checks the live site serves that commit. That file is the record of what's live.

**Operations** (from 19 November 2026): errors and timers go to Application Insights `spartanreferee-insights`, with an alert on API failures and a £100 monthly budget alert. The site signs in to the learning database as `learn_app`, which can read and write the `learn` schema but can't change tables or audit entries (`scripts/learn-app-user.mjs`); the admin login is only for migrations and scripts. The database bills for use beyond the free allowance instead of pausing. The control app backs up the table data every night to the private `backups` container (30 days). What to do when something breaks, and how to restore: [docs/runbook.md](docs/runbook.md). Personal data requests: [docs/learning/privacy-draft.md](docs/learning/privacy-draft.md) (a draft for Spartan).

Personal test videos (`clips/`, `test.mp4`) stay on this PC: they're never deployed or uploaded. Cloud tests use public footage.

## The judge page

`judge.html` and `app.js` judge from a camera, a stream or a video file. On a server it runs in two modes:

- `?engine=<camera>`: the judge itself, running the models and sending what it sees.
- `?follow=<camera>`: what people watch, playing the same camera and drawing what the judge sent.

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
| `judge.html`, `styles.css` | The Burpee Judge's screens and race-day styling |
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
| `cones.js` | Finds the cones in front of the athletes (by colour and shape, kept only if they stay put) for the Cones setting |
| `digit-model.js`, `digit-model.json` | The small digit model and its trained weights |
| `tools/` | Scripts that rebuild the digit model: `python tools/render_digits.py C:/Windows/Fonts train.bin 70`, then the same with `test.bin 12 99`, then `node tools/train_digits.mjs train.bin test.bin` |
| `tests/` | Unit tests: `node --test tests/*.test.mjs` |

Everything runs on the phone: MediaPipe Pose for body tracking and a choice of number readers (Settings → **Number reader**). No server is needed and nothing is uploaded.

## Running it

**Phones first.** Referees use the site on their phones, so every page has to work at phone width. Under 640px wide the header is the name and a **Menu** button (`drawPhoneMenu` in `api-base.js`, styles at the end of `headjudge.css`), and everything people tap is at least 44px tall. With the local dev server running (`ADMIN_EMAILS=boss@example.com node api/dev-server.js`), `node scripts/mobile-check.mjs [folder] [width]` opens every page in Chrome at phone width (360 by default) as a referee and as an admin, lists anything that makes a page scroll sideways or is too small to tap, and saves a screenshot of each. Run it at 320 and 390 too before deploying a change to a page.

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

### Judging a phone's stream on a computer

Phones film with Larix and stream to MediaMTX on the judging computer (over the internet, each phone also needs the Tailscale app, signed in to the same account as the judging computer and switched on) (set up with the "PC streaming setup (Windows)" download). On that computer, open the app in Chrome and tap **Judge a phone's stream (PC)**, then give the stream's address from "Streaming - connection details" (the localhost one, e.g. http://localhost:8889/live/station1/whep; browsers block an https page from fetching plain http elsewhere on the network). The app receives the stream over WebRTC (WHEP) and judges it exactly as it would its own camera, recording the evidence video as usual. A dropped stream shows "Stream lost – reconnecting…" and reconnects every few seconds. The phone version of the app is unchanged.

### Several athletes at once (test)

The home screen has two test buttons: **Detailed test with a video** (analyse first, below) and **Real-time test with a video**: the video plays at normal speed and is judged on whatever frames the device keeps up with, exactly as a live camera would be, so it shows how that device would really do at a race (this laptop managed about 9 frames a second on the three-athlete clip, and got it wrong: 2 athletes found instead of 3). The setting below picks what a test does when started from Settings. During a test, a status line shows frames analysed a second, whether the person finder is running (graphics chip, processor, or off) and how many people are in view; the ⟲ and ⟳ buttons turn a video filmed with the phone on its side upright (real-time tests). People in a hi-vis yellow top (officials) are never counted. Athletes do their burpees on one spot, so each one has a home spot (where their hips have been over the last few seconds): followed frame to frame in matching clothes they can go anywhere (walking off at the end), but picked up after being lost, their track only takes a body within about 0.7 of a body height of that spot, so it can't cling to someone walking past or a neighbour; and a newcomer only carries on a missing athlete's count if they turn up on that spot (so after a big camera move an athlete may get a new number). An athlete out of sight for more than 20 seconds has finished and gone: their count stands (dimmed in the list), and nobody who appears later is matched to them or carries it on. When judging as it happens (live, or a real-time test) the extra looks for half-hidden people are rationed (one per frame, a quarter-second apart per person) so the app keeps up; a detailed test does them all. During a test, a bar at the bottom pauses the video and jumps to any point. In a detailed test the picture, counts and list show exactly that moment (sounds of reps jumped over are skipped); in a real-time test, judging carries on from the new point as if the camera had cut there (counts so far stay; reps jumped over are not seen).

Settings → **Uploaded test videos** → **Analyse first, then play at normal speed** (default): the app works through every frame of the video first (15 a second, with a progress bar; nothing is skipped however slow the device), then plays it at normal speed with outlines, counts, the athlete list and the rep sounds appearing as they happened. The wait is about as long as slowed-down playback would take. The other two choices play while analysing: an uploaded video is slowed down until the phone can analyse enough frames to catch every jump (at normal speed on a phone that can't keep up, most jumps are missed: on the three-athlete clip at 6 frames a second, one athlete got 1 rep and 5 "jump" no-reps). **Faster** (default) aims for 10 frames a second, fine for athletes in clear view; **Most accurate** aims for 15, which also picks up an athlete half hidden behind another.

Settings → **Spartan default** sets the race-day setup in one tap: burpees, several athletes at once, no race numbers, strictness 20 (lenient), forgiving body tracking, Full pose model, count called out, video recorded.

Everyone the app is tracking gets a thin grey outline, so you can see they have been picked up; at their first good burpee it turns into their own colour with a number.

Settings → **Athletes in view → Several at once** (the default; **One at a time** is the race-number flow above) counts everyone in view separately, with no race numbers. Opening the station starts counting straight away; each athlete gets a number (1, 2, 3, in the order they start) at their first good rep, a colour of their own, a label in that colour above their head with their count, and a row in the list at the top left. The outline flashes green or red on each rep. Officials and spectators who never complete a rep aren't labelled. **End round** saves one result per athlete, all sharing the round's video.

Settings → **Cones** (off by default) is for events where each athlete does their reps behind a cone. The judge finds the cones (the colour chosen, a cone's shape, and still from one look to the next), and only someone doing reps near a free cone becomes an athlete, tied to that cone: an official or someone walking past isn't counted, and an athlete lost for a moment is picked up again behind their cone, which moves with the picture if the camera drifts. A number on a cone is read and becomes that athlete's number until one is read from them. Until a cone has been found, it judges as it would without. Tested on a clip with two cones painted on: both found, 7 and 12 read, each athlete given theirs; not yet tried on footage with real cones.

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

## Before using it for prize money

- **Tune the thresholds on real footage.** A test video plays slower when the phone can't analyse 15 frames per second of it, and is judged on the video's own clock, so it's judged the same on any phone. The burpee defaults were set from one real side-on clip of 18 acceptable penalty burpees (17 counted; the last one missed hands over ears by about 1.5 cm). That clip is the middle of the strictness slider: about 10 of 18 pass at 75, 3 at 90 and none at 100. Film some burpees at a real station: good ones, shallow ones, no-jump ones and lazy-arm ones. Load them with **Test with a video file** and switch on **Show measurements on screen** in Settings. Move the strictness slider until the app agrees with a human judge. The defaults are reasoned starting points, not calibrated values.
- **Camera placement matters most.** Use a tripod, put the athlete 3–4 m away and keep the whole body in view, including when lying flat. A slightly angled or side-on view judges chest to ground better than straight-on.
- **Race-number reading is the weakest part.** It copes with tilt up to about 25°, light-on-dark print, mirrored front cameras and background clutter, but creases, mud, glare and curved bands still cause trouble. A wrong number is unlikely, since low-confidence reads are rejected, but "can't read it" will happen. Adding a QR code to wristbands would make this near-perfect. Paste the start list in Settings so only real race numbers are accepted.
- **Keep a human in the loop for disputes.** Every attempt has a video with each rep's time in the CSV, so a marshal can review any claim.
- **Results are stored per phone.** Export the CSV from each phone after the race and combine them. Live results shared across all stations would need a small backend.
