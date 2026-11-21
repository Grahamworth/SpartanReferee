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

### Invites, the one app, events and progress (19 November 2026)

At the user's request, SpartanReferee became invite-only and one app.

**Joining is by invite only.**
- An admin uses **Invites** (`learn/invites.js`, server `api/src/learn/invites.js`, migration `007-invites.sql`):
  - Paste one address or hundreds.
  - Choose the type of user (referee, regional coordinator with their region, assessor or programme owner or content editor with their programme, technical admin, admin).
  - Tick the programmes they must complete, with an optional complete-by date and a message.
- Each person gets an emailed link (`join.html`, valid 30 days; resend makes a new link, cancel stops it).
- There they give their full name, region and language, then sign in with Google, Microsoft or **Sign in with email**: a 6-digit code emailed to them, valid 10 minutes, 5 tries.
- Registering puts them on the referee list, gives their roles, enrols them with the date, and keeps their language. The admin page's Referees list no longer adds people.
- A second sign-in method with the same address is the same person.

**Email.** Email goes through Azure Communication Services:
- The resources are `spartanreferee-email` (an Azure-managed domain, sending from DoNotReply@…azurecomm.net) and `spartanreferee-comms`.
- The code is `api/src/mailer.js`, with the site settings `EMAIL_CONNECTION` (a secret) and `EMAIL_FROM`.
- Locally a pretend mailer keeps messages, readable at `/api/dev/mail`.
- Emails are in English for now.

**One app (`learn/`).** Everyone lands on **Home**, and `home.html` sends there too. Home shows:
- the name with the person's badges under it;
- their next event, which opens the event;
- their programmes with progress, each opening the programme;
- a refresher nudge, organiser tools, and the install card.

Tabs: **Home**, **My Learning**, **Events**, **Rules**, **Obstacles**, plus role tabs (Manage Events, People, Programs, Assessing, Reports, Duplicates, Audit log, Diagnostics, Config). **Events** is now **My Events**. Which role sees which tab is each tab's `data-show` in `learn/index.html`.
- **My Learning** (was Programmes) shows to do (progress, next lesson, complete-by date), completed, Keep sharp, then other programmes to enrol in.
- **My profile** is the person icon at the top right.

**Events** (`learn/events.js`, server `api/src/assignments.js`):
- Everyone sees their own events, upcoming and past. Each event's page has Spartan's page for it, organisers' notes, the referees (names only), and its SpartanReferee cameras.
- Watch and review is for everyone assigned. Booking is only for those the organisers ticked (a per-person "Books the cameras" tick); a head referee assigned before ticks existed keeps booking.
- Admins, and regional coordinators for the events in their regions' countries, manage events: they add referees by pasting addresses, set the head referee, tick who books, and write notes. Events now keep their country code for this.

**People** (`learn/tracking.js`, servers `api/src/learn/tracking.js` and the people list in `api/src/learn/index.js`): one list, each person once with how far they are in each programme under their name (People and Progress were merged on 19 November 2026; `#/progress` opens People). Admins invite from the "add person" icon at its top (People and Invites switch there).
- Admins see everyone, programme owners and assessors their programmes, and regional coordinators their region.
- Filter by programme, region, status and name, then tick people or all shown.
- Email reminders to complete by a date; the date becomes their complete-by date, and when they were reminded is shown.

**Preview as** (admins only, the bar under the tabs): your own account as a type of user (referee, regional coordinator, assessor, programme owner, content editor, technical admin) with only that type's roles; **Back to yourself** returns. The app sends `X-Learn-As-Role`, the other pages `X-Preview-Role` (localStorage `sr_preview_role`). Everyone else just has their own type. The invented demo people are gone from the live site; `scripts/learn-seed.mjs` makes them only with `DEMO_PEOPLE=1`, and `scripts/learn-remove-invented.mjs` removes them (a dry run unless `--write`).

**Signing in from an invite** says which address to use and fills it in: Google and Microsoft get it as `login_hint`, and the emailed code's box is fixed to it. Registering with another address is refused, naming the invited one.

**The tabs** (20 November 2026, the user's order and names): Home, Events, Learning, Obstacles, Rules, Assessing, Manage Events, Manage People, Manage Programs, Admin Reports, Admin Audit Log, Admin Diagnostics, Admin Config (`learn/index.html`; each tab's `data-show` says who sees it). Duplicates went (a possible duplicate is still flagged when someone is added). Alongside:
- **Install the app** is a button in the header, only on an Android phone or tablet, an iPhone or an iPad, and not once installed (`installButton` in `offline.js`): Android installs from it, Apple devices get the two taps in Safari. The Home page's install card went.
- **Events** is read only: an event's notes show, and managing it (referees, who books the cameras, notes) is only in **Manage Events**, whose list and event pages warn while an event's cameras aren't booked (`camerasBooked` from `bookedUnits()` in `servers.js`). Its notes are written, edited and removed in the one card where they show.
- **Learning** opens with the **Keep sharp** bar once some lessons (and their quick checks) are done: a refresher question to answer there, a question at a time (`partial` answers; the round's last counts as a refresher), the streak, and how close the two nearest badges are (each badge now has `have` and `need`).
- **Rules**: a rule's page says where it applies: the obstacles it's about (and "at every obstacle"), the lessons that teach it and the questions that test it, once each; every citation by language and version is folded away underneath. The list shows the obstacles each rule applies at.
- **Manage People**: a person is one line (name, contact, how many programmes, completed and overdue) until clicked.
- **Admin Config** has only the cameras (running, booked, camera hours), the AI judge's costs (this month, per server-hour and per camera-hour) and the admins. Who can sign in is in Manage People (invites).

**Lessons: Start, Continue, Finish and test** (20 November 2026): a programme's page has one big button into the lessons, **Start** until any lesson has been opened and **Continue** after, naming the lesson it opens (`nextTitle`, `started` from `programmeExtras` in `lessons.js`). Saving the programme for offline is a small download icon beside "Your progress" (a tick once saved, which opens Update and Remove). A lesson with questions ends with **Finish and test**: the slides are put away and the questions asked. With any answer wrong the learner can **take the test again** or **go through the lesson again**; by default a lesson counts as done (and the next one opens) only once a try has every answer right. A programme's owner or an admin can turn that off in its **Programme settings** ("Lessons need a pass", `programme.lessons_need_pass`, migration `010-lessons-need-pass.sql`), and then taking the test is enough. The server enforces it (`ctx.testDone` in `checks.js`, used by lesson completion). Every try is kept in `lesson_test` (migration `009-lesson-tests.sql`, which also brought in the earlier quick checks from the audit log), and **Assessing** has a **Lesson tests** card for assessors: per person, the share of lessons passed right first time, lessons passed, tries and answers right, and per lesson each try (`GET /api/learn/assessing/lesson-tests`).

**The final assessment** (20 November 2026): every programme ends with an assessment of 10 multiple-choice questions drawn at random from a large pool, 80% to pass, 3 attempts; when none passes, the programme starts again (its finished lessons move to `completion_archive`, kept but not counted, and its lessons and their tests are done again before the assessment reopens). Each is a **Programme setting** (on or off, pass mark, questions each attempt, attempts), on the `programme` table (migration `011-final-assessment.sql`); the version's own pass mark and attempts aren't used any more. A draw (`draw()` in `api/src/learn/assess.js`) takes the questions this person has seen least (never seen first), spread across the programme's modules (`question.topic`), so no attempt repeats a question while unseen ones remain; the attempt keeps the ones it drew (`attempt.question_ids`). A programme completes on its lessons and, when the assessment is on and has questions, a pass. The pools are `scripts/learn-pools/<programme>.json` (60 for OCR Referee, 40 each for Referee Essentials and the Burpee camera station), written by Claude from each programme's own lessons and rule references and not yet reviewed by Spartan; `node scripts/learn-pools.mjs` adds them to each programme's published assessment (once each; it also turns the placeholder DEKA programme's assessment off). The pools' questions, answers and feedback are in all 15 languages (machine translations by Claude, not yet checked by native speakers; `scripts/i18n-extract.mjs` lists them from the pool files). Points the sources disagree on (the time for missed burpees, the skipped-loop penalty, touching the top of an obstacle) were left out of the pools.

**New programmes are closed on the live site** (20 November 2026, the user: "We are not allowing the creation of new programmes just yet"): My Learning no longer shows the New programme form, and the server refuses one even from an admin. The dev and test schemas keep it (the tests and local work need it). To open it on the live site, set the site app setting `LEARN_NEW_PROGRAMMES=on`. Existing programmes are edited in Programs as before.

**Programs** (`learn/authoring.js`, server `api/src/learn/authoring.js`, migration `008-authoring.sql`; admins, programme owners, content editors / translators). Reviews and Media are inside it now. A lesson is edited where it stands:
- Type straight into its headings, bullet points (Enter adds one, Backspace on an empty one removes it), what the voice says and the note; tap the picture to choose another; move, add or remove slides.
- Its quick-check questions: the question, the answers (tick the right one), and what shows after answering.
- Another language shows the English above each line to translate; pictures and right answers come from the English, and a line left empty stays English. Quick-check translations are kept with each question (`tr` in `lesson_check.body`) and shown in the learner's language (`localQ` in `learn/sharp.js`).
- Everything saves as you type, as a draft (a `content_version` in state `draft`, body `{ slides, checks }`); the lesson order waits in `pending_order`. Learners see none of it until a programme owner or an admin presses **Publish**, which publishes every draft of the programme and its order at once. **Discard** throws drafts away.
- The lesson player's old form editor is gone: editors get an "Edit this lesson" link to Programs.

**Manage Events** (`#/manage`, admins and regional coordinators): every event they look after, each opening its page to add referees, set the head referee, tick who books the cameras and write notes. Admins also see when Spartan's events were last synced, with Sync now (moved from Config).

**Obstacles** (`#/obstacles`, everyone; 19 November 2026): every obstacle type a referee may stand at, grouped by kind with a small drawing each, searchable and filtered by how many tries (multiple attempts, one attempt, mandatory). Each obstacle's page says how it's done, **Good: it counts** and **Bad: it's a fail**, any note (when the athlete is committed, the penalty), and links to its rule reference where there is one. Where the 2026 programme sorts an obstacle differently from the rulebook it says it's under review for 2027. The text is a summary in our own words of Spartan's 2026 Rules of Competition, taken from the Spartans app's Course Run rules (`course-rules.js` there) and checked line by line against Part D of the rulebook; every obstacle shows its rulebook section. It all lives in `learn/obstacles.js` (no database). When Spartan updates the rules, update it there. Languages: English and German so far; translations into the other 12 were drafted (not merged) and are to be added later.

**Obstacle animations** (19 November 2026): each obstacle's page (all but the Iconic obstacle) opens with a drawn animation: a jointed athlete seen from the side (from behind for the sideways traverses), with the obstacle drawn in the page's colours. It loops: the good run at real speed; the same again, slowing down and stopping on what counts (✓, green ring and caption); then each fail, stopping on the moment it goes wrong (✗, red, with the part at fault in red). Buttons jump to each part or pause it, and it starts paused for people who've asked their phone for less motion. The captions are the obstacle's own Good and Bad lines, so they're translated with them. `learn/obstacle-anim.js` is the engine: an athlete in real proportions (1.78 m at 52 px to a metre; red top, navy shorts, shoes, headband, face), posed by keyframes of hips, lean, facing, hands and feet, with elbows and knees solved and the feet turning with the shins. Motion between keyframes is a monotone cubic (smooth, never overshooting a grip or the ground); jumps, drops and falls follow gravity, the rigs swing like a pendulum from the hands, and the spear flies a real projectile path nose-first. Obstacles are drawn to size (8 ft walls, a 15 ft rope, a 3.7 m A-frame, a 7.5 m spear throw). Seen from the side, a knee always bends one way and an elbow the other; if a hand or foot can't reach what it's put on, the hips shift towards it (as a person leans or sinks to reach). `node scripts/check-motion.mjs` checks every frame of every animation for movements a person can't make (a knee or elbow bent backwards, a hip past its range, a limb short of its grip, a foot through the ground, impossible speed); a test runs it, `learn/obstacle-scenes.js` has each obstacle's drawing and timelines; they load only on an obstacle's page. `learn/obstacle-sheet.html?id=walls` (on a local run only, not published) shows every frame of a scene, for checking poses.

**Obstacle videos and calls to make** (19 November 2026, from the *Spartan Referee 2026 Penalty Videos* prototype deck): nine obstacles have a demonstration video under their animation (Stairway to Sparta, Multi-Rig, Monkey in the Middle, Twister, Helix, Olympus, Z Wall, Tyrolean Traverse, Tire Flip; YouTube ids in each obstacle's `video` in `learn/obstacles.js`). Monkey in the Middle (4.2.19) and the Tire Flip (4.1.14) were added as obstacles for it, with animations. A video is just its picture until tapped (nothing loads from YouTube before that), then plays from youtube-nocookie.com with captions on and set to the site's language (`learn/video.js`): the video's own track in that language if it has one, otherwise YouTube's translation of the English (these videos only have YouTube's automatic English captions; Olympus and the Tire Flip have none). Where the phone won't start a video with sound once the player has loaded (iPhones: only straight from a tap), it starts muted, with captions, within a second or so; otherwise the tap would land on YouTube's own play screen, whose title and logo open the YouTube app. Four obstacles (Z Wall, Olympus, Stairway to Sparta, Tire Flip) have a "Make the call" question from the deck: tap an answer to see whether it's right and why. The other deck, *Spartan Referee 2026 Mobile Prototype*, is a short course (mission, race day, obstacle types, penalties and burpees, conduct) with no videos: it belongs with the programmes, not here.

**Slide pictures, videos and animations** (19 November 2026): in Programs, a slide's picture box offers four tabs: a **Drawing** (the simple figures as before), an **Animation** (any obstacle's, or the burpee standard: it plays a good run, then slows on what counts and on a fail), a **Picture or video** uploaded from the device (JPG, PNG, WebP or GIF up to 15 MB; MP4, WebM or MOV up to 500 MB), or a **YouTube link** (captions in the learner's language where YouTube can translate them). A slide keeps it as `media: { type, src }` (`api/src/learn/lessons.js` checks it); it's set in English and every translation shows the English slide's visual. Uploads go up in pieces through the API into the storage account's `learn-media` container under `slides/` (`api/src/learn/slidemedia.js`), and `GET learn/slide-media/<file>` (no sign-in, as an `<img>` or `<video>` can't send one; the file name is a random id) sends the browser on to a short-lived storage link. `learn/slide-visual.js` draws a slide's visual for the player and the editor. 21 slides in the existing lessons now show an animation (the burpee lessons, the obstacle types, the Spear Throw, the walls, bells and scenarios): `scripts/learn-visuals.mjs`, put on by the seed once per lesson.

**Referee Essentials** (19 November 2026): a new programme from the *Spartan Referee 2026 Mobile Prototype* deck, in English and German (`scripts/learn-essentials.mjs`): five modules (welcome, race day, obstacle logic, penalty logic, conduct), one lesson each with animations, and the deck's "make the call" questions as quick checks. Completion is the lessons (no assessment). The time for missed burpees is taught from rule 3.4.2 with an "under review" note, as the OCR programme flags the sources' disagreement.

**All 15 languages** (19 November 2026): the obstacles pages, videos, calls to make, animations and the lesson editor's picker are translated into every language the site offers, and Referee Essentials is in all 15 (machine translations, not yet reviewed).

**Promo video** (`promo/`): `promo/spartanreferee.html` is the video as a page that draws any moment (the older `promo/promo.html` is the HeadJudge Broadcaster promo); `node promo/shoot.mjs` takes phone screenshots of the local site (`node api/dev-server.js 8795`), `node promo/peek.mjs 3 14 30` shows a few stills, and `node promo/render-spartanreferee.mjs` draws every frame in headless Chrome and makes `promo/out/spartanreferee-promo.mp4` with ffmpeg (1920 × 1080, 49 s, no sound). The frames, shots and video aren't kept in git.

**One look, one menu (19 November 2026).** Every page uses the study look (`study.css` with `look.js`: light or dark following the phone, or the Look button). The pages outside the app (Config `customers.html`, the cameras `console.html` and `event.html`, `results.html`, `streaming.html`) get the app's tabs and profile icon in their header from `appnav.js`, which reads the tab list from `learn/index.html` (`<header class="top" data-tab="...">` says which tab is on). Admin is now **Config**. Pages that load slowly show a spinner.

### Home page, assigned events and learning

**Where people land:** signing in, and opening the installed app, lead to Learning's overview (`/learn/`), from 19 November 2026 at the user's request. The overview also shows the referee's next events, the ways to the cameras and (admins) the admin page, and the Install card (`learn/landing.js`). Signing in from an event's page or the console still returns there. The home page is still there, from the **Home** link in Learning's header. It is each person's home page (`home.html`, from 19 November 2026; data from `GET /api/home` in `api/src/assignments.js`): their name, the upcoming events they're assigned to (each marked head referee or referee), and the ways to **Learning** (`/learn`) and **Cameras** (the console). Admins also get **Admin**.

Tapping an event opens its page (`event.html?id=<event id>`, `GET /api/event/<id>`): its dates and place, its burpee cameras (**Book the burpee cameras** for its head referee and admins, **See the booking**, or once they're on **Watch live** for everyone, all on the console: `console.html?unit=e<event id>`), who's refereeing it (head referees first, by the name they signed in with), each day's camera hours in local time and the viewer's own, and Spartan's page for it. Any referee can open any event's page.

Admins assign referees to events on the admin page ("Who's refereeing each event"), as **head referee** or **referee**, and can switch either way: anyone on the referees list, or an admin. An event can have more than one head referee. An event's head referee books and runs its burpee cameras (admins can too); every referee can watch them and review the results. An assignment stays until it's removed; it stops showing once the event is over.

The learning platform (`/learn`, `api/src/learn`) is open to everyone in the organisation (admins only before 19 November 2026). Someone's first visit makes their record there with just their name and address: an admin's as a global admin, a referee's as a learner with no other role. Anyone taken off the referees list loses it at once too. Apart from those real records, everyone in it is invented. Its database pauses after an hour unused; the first visit after that wakes it, which can take up to a minute (the API tries for about 30 seconds, then asks to try again in a minute).

### The learning platform (/learn)

Spartan's Learning & Competence Platform prototype (from their requirements v0.2): one profile, any number of programmes, lessons with narration and a Spanish pilot, assessments with assessors, demonstration credentials, versioned rule references with review items, a handbook PDF, reports and a read API. It has its own Azure SQL database and its own documentation: [docs/learning/README.md](docs/learning/README.md) (setup, demo people, tests), [architecture](docs/learning/architecture.md), [decisions](docs/learning/decisions.md), [read API](docs/learning/api.md), [acceptance tests](docs/learning/acceptance.md) (all 12 pass) and [backlog](docs/learning/backlog.md).

### The installable app (offline)

Added 19 November 2026. Home and Learning install as an app: Android and desktop Chrome or Edge offer **Install** on the home page and Learning's overview, and on an iPhone the card explains Share → Add to Home Screen. `manifest.webmanifest` opens the app on Learning's overview (its id stays `/home.html`, so phones that installed it earlier keep the same app). The service worker `sw.js` keeps Home and Learning's own files: it takes them from the network when there's signal and from its copy when there isn't, and leaves the API and the camera pages alone. Any other page opened offline shows `offline.html`. `scripts/deploy-site.sh` stamps the commit into `sw.js`, so each deploy refreshes the phone's copy.

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

Each server also saves its athletes, tracking and numbers to cloud storage, so `results.html` can show a company's past week, to search, watch and download, whether or not a server is on. Each run of a server saves under its own name (`results-run.txt` in the server's data, sent as `run`; `resultsBase` in `api/src/recordings.js`): servers are made afresh for every booking and number their athletes from 1, and with one folder a new booking's athlete 1 replaced the last booking's. **Download with tracking** on an athlete makes their video with the skeleton and the count drawn into the picture (`saveAthlete` in `results.js`): the recording is played through once in the browser, each frame drawn on a canvas with the tracking on top, and the canvas recorded with the recording's sound, so it takes as long as the athlete was on camera and nothing is sent anywhere. The page has to be allowed to read the recording's picture, so the storage account's blob service has a cross-origin rule for the site's address (`az storage cors add --services b --methods GET HEAD OPTIONS --origins https://<the site> --allowed-headers range --exposed-headers Content-Range Accept-Ranges Content-Length Content-Type --max-age 3600`); without it the download says the recording couldn't be read, and Watch and the plain download still work. Recordings are kept for 7 days (`KEEP_DAYS` in `api/src/recordings.js`, the lifecycle rule `recordings-7-days` on the storage account, and `keepDays` on each server). Customers pay per camera, per hour the servers actually run: Azure's server price (the site setting `SERVER_HOUR_PRICE`) shared by its 2 cameras and the cost of storing what's recorded, plus the percentage set in the admin area, `customers.html`. A booking keeps the price it started at. The control app adds up time, cost and charge by the minute. `MAX_RUNNING_SERVERS` must fit the subscription's graphics-card limit (8 vCPUs is one server).

The video review’s Results tab (`server/review`) is laid out as `results.html` is: what is being watched on the left (an empty stage until someone is chosen, with the numbers shown to a camera under it), and the athletes in a card beside it, one to a row with Watch and **Download with tracking**. Its download is the same idea as the website’s (`saveAthlete` in `server/review/review.js`), reading the clip from the server. On `results.html`, anyone found in a video analysed after it was made (an upload, or a camera’s own recording analysed as a previous recording) is timed from the start of that video (`videoClock`), listed under the camera that filmed them at the time they were filmed, and the From and To filters go by that time of day.

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

## From the phone to the replay: timing, recordings, smoothness

Measured on a real two-camera session (20 November 2026) and fixed the same day; the numbers are in the comments of the files named.

- **Skeletons line up with the picture.** The streaming server names a recording by when its first frame arrived, but a phone's first couple of seconds arrive all at once when it connects, so the recording's own clock then runs about 2 s ahead of when frames really arrive, and a skeleton saved by the judge's clock was drawn 2 s ahead of the body. `server/segments.js` measures how late each recording runs while it's being written (the end of what's in the file against the time each part was written). The review's clips are asked of the streaming server by the recording's clock (`/clip` in `server/review-api.js`), and a recording goes to cloud storage with the time it really started, to the millisecond. The judge times each saved frame by when it arrived, read off a steady line through the arrivals (`arrivalClock` in `multi.js`), not by when it got round to looking at it. The review's nudge (± under the athlete's video) is still there, and starts again from 0.
- **Recordings open at once on the website.** The streaming server writes a recording a second at a time, with nothing saying how long it is: a browser read all of a 282 MB recording, twice over, before showing a frame. `server/faststart.js` writes the same frames as an ordinary MP4 with its index at the front on the way to cloud storage (2 requests to open it; the copy on the server is untouched). Anything it doesn't understand goes up as it is.
- **Nothing moves in steps.** The website's Watch (`results.js`) and the live outline (`blendSnaps` in `multi.js`) draw each person part-way between two of the judge's looks, as the review's athlete video already did. Two cameras replayed together are kept in step by playing one a touch faster or slower, not by jumping. People watching live have a fifth of a second of picture in hand, so one that reaches the server in bunches still plays evenly.
- **Phones follow their connection.** The Broadcaster app lowers its bitrate by a third when what's waiting to be sent builds up, and creeps back up while the connection keeps up (`StationActivity.java`); the Larix link turns on Larix's own (`adaptiveBitrate`). Before, a phone on weak mobile data kept sending 3.5 Mbit/s, fell behind and was cut off again and again. The review says when a camera keeps dropping off, and when a judge is looking fewer than 6 times a second.

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

Stepping through a video frame by frame (seekTo in app.js: the detailed test, and every uploaded or previous recording a server analyses) waits for each new frame to be reported, for half a second at most. A step that gives up takes back its request for the frame. Left waiting, that request answered for the next frame before the next step could, and every later step then waited the full half second: a two-minute recording took 21 minutes to analyse on a server, and about two with this fixed (20 November 2026).

Settings → **Uploaded test videos** → **Analyse first, then play at normal speed** (default): the app works through every frame of the video first (15 a second, with a progress bar; nothing is skipped however slow the device), then plays it at normal speed with outlines, counts, the athlete list and the rep sounds appearing as they happened. The wait is about as long as slowed-down playback would take. The other two choices play while analysing: an uploaded video is slowed down until the phone can analyse enough frames to catch every jump (at normal speed on a phone that can't keep up, most jumps are missed: on the three-athlete clip at 6 frames a second, one athlete got 1 rep and 5 "jump" no-reps). **Faster** (default) aims for 10 frames a second, fine for athletes in clear view; **Most accurate** aims for 15, which also picks up an athlete half hidden behind another.

Settings → **Spartan default** sets the race-day setup in one tap: burpees, several athletes at once, no race numbers, strictness 20 (lenient), forgiving body tracking, Full pose model, count called out, video recorded.

Everyone the app is tracking gets a thin grey outline, so you can see they have been picked up; at their first good burpee it turns into their own colour with a number.

Settings → **Athletes in view → Several at once** (the default; **One at a time** is the race-number flow above) counts everyone in view separately, with no race numbers. Opening the station starts counting straight away; each athlete gets a number (1, 2, 3, in the order they start) at their first good rep, a colour of their own, a label in that colour above their head with their count, and a row in the list at the top left. The outline flashes green or red on each rep. Officials and spectators who never complete a rep aren't labelled. **End round** saves one result per athlete, all sharing the round's video.

Someone new only becomes an athlete by a first rep done in one go, in the picture (`firstRepMs`, `firstRepEdge` in `multi.js`): within 10 s from going down to the jump, and not at the very side of the picture. On the test session real first reps took 2.4–2.8 s, while of six people wrongly counted, four had taken 17 s to over 3 minutes (a bystander who bent down once and stretched later, a camera being moved) and one was a reflection in a mirror at the edge. Someone refused starts again from nothing, so a real athlete is picked up at their next rep; once someone is an athlete, a slow rep still counts. The first rep's jump must also be read from a foot the pose model is sure of (`firstRepFoot`, 0.7): feet hidden behind furniture are guessed, and the guess moving was read as a jump for someone who bent over an armchair. In 86 real first reps the foot was 0.80 sure or more every time; in the false ones 0.32 and 0.60.

The jump is measured from where the feet were while the athlete was back upright, including the frames just before the one that settled it (`upFeet` in `burpee.js`). Taking the floor only from later frames missed real jumps whenever the judge looked 10 times a second or fewer, because by then the feet had already left the ground. Replayed on real footage (20 November 2026), burpees counted went from 67% to 94% at 10 looks a second and from 25% to 88% at 6, with no change at 30. The video review warns when a judge is looking fewer than 12 times a second (`JUDGE_SLOW` in `server/review/review.js`).

The pose model follows 5 people at once, and 10 while the person finder keeps seeing more than 5 (`peopleWanted` in `multi.js`). Every extra person followed takes time on every frame, shared by everyone in view.

**A live judge is for one to three athletes a camera, in clear view.** Measured on a real server on 20 November 2026, with race footage and recordings of single athletes put side by side and streamed as phones send it: with 2–3 athletes in clear view the live judge counted 76% of the real reps; with 4–6, 22%; with 8–12, 9%; with ten in clear view, 2%, with false reps as well. An athlete standing behind another was counted 17% of the time even with only three in view. Speed was not the cause (17–25 looks a second with one busy camera, 13–17 with two): in a wide picture of ten people each is about 100 pixels tall, and both the pose model and the person finder, which shrink the whole picture to look at it, stop finding them.

**A crowd gets a deep analysis afterwards.** A video analysed on a server after it was made (an upload, a previous recording) isn't against the clock and has the server's graphics card, so it is searched as deeply as it can be (`findEveryone`, `DEEP_LOOKS` in `app.js`; a video analysed in someone's own browser or on a phone is analysed as before): the person finder looks at the picture in full-detail parts as well as whole (`finderTiles` and `mergeBoxes` in `multi.js`), and everyone being followed who wasn't found in a frame gets a zoomed pose search of their own in that frame. On the same ten athletes in clear view it counted 84% of the real reps, one athlete made for each, with no false reps. It is slow: with ten people about ten pose searches a frame, eight or nine times the video's length on a T4. The finder's search of the parts adapts (`partsDue`): every part every time with four or more people about, a light search otherwise, so one athlete's video takes little longer than it did.

A live judge can't do that and keep up, but its person finder can tell a crowd is there: five or more people in view for three seconds, counting officials and anyone else near enough to the camera (`crowdSeen` in `multi.js`; on a server the finder takes one part of the picture as well as the whole each time, in turn). The judge then tells its server (`POST /api/engine/<n>/crowd`), the camera's tile in the video review says **Crowd: deep analysis to follow**, and every recording filmed while it lasted is analysed again in full once it's finished (`server/deep.js`): queued like an uploaded video, so live judges still come first, and listed under the camera's recording like a previous recording analysed later. When it's done, what the live judge counted in that stretch gives way to it (`givesWay`: unless the deep analysis counted fewer reps than the live judge did, when both stay listed). The video review's Results and the website's Results say while one is waiting or running, and when one never finished because the server stopped first; such a recording can be analysed on a later server from the video review's Results (A previous recording). When it has been, the website takes that analysis in place of what the live judge counted in that stretch, by the same rule (`recordings/results` in `api/src/recordings.js`). The demo footage and the scripts that measured all this are not in the repository.

Settings → **Cones** (off by default) is for events where each athlete does their reps behind a cone. The judge finds the cones (the colour chosen, a cone's shape, and still from one look to the next), and only someone doing reps near a free cone becomes an athlete, tied to that cone: an official or someone walking past isn't counted, and an athlete lost for a moment is picked up again behind their cone, which moves with the picture if the camera drifts. A number on a cone is read and becomes that athlete's number until one is read from them. Until a cone has been found, it judges as it would without. Tested on a clip with two cones painted on: both found, 7 and 12 read, each athlete given theirs; not yet tried on footage with real cones.

How it keeps people apart: everyone in view is tracked, athlete or not. Each person is matched to where they were last seen, but only to a body that could really be them a moment later: no further than a person moves in that time (about two body heights a second), no flip between lying and standing within a quarter of a second, and no clearly different clothes. Each track remembers the colour balance of its top (sampled across the torso) and shorts, separately for standing and lying down, and colour weighs in every match. A body is compared with both of those looks and the nearer one decides (`clothesGap` in `multi.js`): under a ceiling spotlight one blue top read as near grey standing and as blue bent over, further apart than two different people's tops, so the athlete was taken for someone else every time they went down, a throwaway track took the jump, and five good burpees were judged five no reps (20 November 2026). Duplicate detections of one person are merged; and a new person whose first rep comes shortly after an unfinished athlete vanished (camera moved, someone walked in front) carries on that athlete's count, unless they were already in view alongside that athlete. People already big in the picture (an official by the camera) are left out of the zoom, and a lost track that never became an athlete is dropped rather than reused, so an official's old track can't take over an athlete. MediaPipe finds people one at a time and often sees two athletes close together as one. So about twice a second a second model, RTMO (finds everyone in one pass, much better at keeping people apart), looks for everyone in the watched area in the background, and anyone it sees that MediaPipe hasn't found gets a zoomed MediaPipe look of their own, with the people found painted over; MediaPipe still does all the judging. RTMO runs on the graphics chip through WebGPU where the browser has it (current Chrome on Android, Safari on iOS 26), otherwise more slowly on the processor; if it cannot load, the app uses painted-over looks instead:  the app takes second looks with everyone already found painted over: twice a second across the watched area (and its left and right parts) for anyone hidden, and, when someone being tracked goes missing, zoomed in on where they were. On a clip of three athletes in a row, this took frames with both of the two remaining athletes found from 5 in 72 to 44, and all three were counted. Second looks cost extra work for the phone. A new athlete found right on top of one already counted and dressed the same is taken as a copy and dropped; someone who walks out of the side of the picture is not carried on by a newcomer. The pose model looks at a zoomed-in part of the frame around the people being tracked, because athletes far from the camera are otherwise found on only a fraction of frames; a second, light model checks the whole frame about once a second for anyone new.

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
