# Putting SpartanReferee on Google Play and the App Store

Written 21 November 2026. The apps are built (README "The phone apps"). What's left is mostly accounts and store forms, and
only the publisher can do those. Decide first **who publishes**: VDASO for Spartan, or Spartan itself. That name shows in both
stores, and the app's id (`com.vdaso.spartanreferee` now) can't change after the first upload. To use another id, build with
`SPARTANREFEREE_APP_ID=…` before uploading anything.

## 1. Accounts (the publisher creates these; Claude can't)

| | Google Play | App Store |
| --- | --- | --- |
| Account | Play Console developer account | Apple Developer Program |
| Cost | $25 once | $99 a year |
| As an organisation | Needs a D-U-N-S number. Organisation accounts skip the 14-day closed test. | Needs a D-U-N-S number, and someone with authority to sign for the organisation. |
| As a person | New personal accounts must run a closed test with at least 12 testers for 14 days before going public. | The person's name is shown as the seller. |

A D-U-N-S number is free from Dun & Bradstreet but can take a week or more. Request it first.

## 2. Google Play

1. Create the app in Play Console (name SpartanReferee, default language English (UK), App, Free).
2. **Play App Signing**: accept Google's signing key. Upload `downloads/spartanreferee.aab`. It's signed with the **upload key**
   in `C:\Users\graha\.spartanreferee\` (`upload.jks` and `upload.properties` with its password). **Back that folder up**
   somewhere safe, such as a password manager. If it's lost, Play support can reset the upload key, which takes a few days.
3. Release it on the **Internal testing** track first. Install it from Play on a real Android phone and sign in.
4. Fill in the store forms (section 4): App access (the reviewer's sign-in), Ads (none), Content rating, Target audience
   (18+; it's for officials), Data safety, Privacy policy, and the store listing.
5. Promote the release to Production (or a closed test first, if it's a personal account).

## 3. App Store

1. In App Store Connect, create the app with bundle id `com.vdaso.spartanreferee`, platform iOS and SKU `spartanreferee`.
2. Make an **App Store Connect API key** (Users and Access → Integrations → App Store Connect API, role App Manager). Add these
   four secrets to the GitHub repo (Settings → Secrets and variables → Actions):
   - `APP_STORE_CONNECT_KEY`: the .p8 file's text
   - `APP_STORE_CONNECT_KEY_ID`
   - `APP_STORE_CONNECT_ISSUER_ID`
   - `APPLE_TEAM_ID`: from the developer account's Membership page
3. On GitHub, Actions → **iPhone app** → Run workflow, with "upload" ticked. Xcode's cloud signing makes the certificate and
   profile itself, and the build arrives in App Store Connect after about 15 minutes of processing.
4. Try it with **TestFlight** on a real iPhone. Sign in, open a lesson, save a programme for offline, turn on flight mode.
5. Fill in the forms (section 4), choose the build, and submit for review.

**Unlisted, perhaps.** The app is for Spartan's referees only, and every account comes from an invitation. Apple's **unlisted
app distribution** (request it at developer.apple.com/contact/request/unlisted-app) keeps the app out of search: only people
with the link find it. It still goes through review, but review is usually easier on an app built for one organisation's staff.
Google's equivalent is a closed testing track, or a private app through Managed Google Play.

## 4. What the forms ask, with suggested answers

**Reviewer sign-in (both stores; neither reviews without it).** Sign-in is by invitation, and in the apps it's Microsoft or an
emailed code. A reviewer can't read a code sent to someone else's inbox, so Microsoft it is. Make a Microsoft
account just for reviewers (for example an outlook.com address) with no two-step verification. Invite it as a referee from
Manage People, accept the invite once, then give its address and password in App access (Play) and in Sign-in information (App
Review). Remove it again when the store no longer needs it.

**Privacy policy URL:** https://brave-forest-022879f03.3.azurestaticapps.net/privacy.html. It's still the draft awaiting
Spartan's answers on who controls the data, the lawful basis and how long data is kept (`docs/learning/privacy-draft.md`).
Both stores will hold the publisher to what it says, so finish it before submitting.

**Data collected** (Play Data safety; App Store App Privacy). Data is not sold, not used for tracking or ads, and is encrypted
in transit.
- Name and email address: account management, linked to the person.
- App activity (lesson progress, answers, assessment results): app functionality, linked to the person.
- Photos and videos: the camera pages film athletes for judging and recordings. App functionality. Spartan should confirm
  whether athletes are told.
- Diagnostics: server logs (Application Insights). Not linked to the person.
- Deletion: an admin can export or erase a person's learning data (Manage People). Apple asks for in-app account deletion when
  an app lets people create accounts. Here accounts come from an admin's invitation, so say that in the review notes. If Apple
  still asks, add a "Delete my account" request.

**Content rating:** the IARC questionnaire gives Everyone (Play) and 4+ (App Store). There's no violence, gambling or chat
between users.

**Export compliance (Apple):** the app sets `ITSAppUsesNonExemptEncryption` to false (it only uses HTTPS), so App Store Connect
doesn't ask.

**Listing text (a draft):**
- Name: SpartanReferee
- Subtitle (App Store, 30 characters): Training for Spartan referees
- Short description (Play, 80 characters): Lessons, rules, obstacles and events for Spartan Race referees, also offline.
- Description: SpartanReferee is the training and reference app for Spartan Race referees. Work through your programmes'
  lessons and assessments, look up any rule or obstacle standard with what counts as a pass or a fail, and see the events
  you're assigned to. Save a programme to your phone and it opens with no signal on the course. Available in 15 languages.
  Access is by invitation from Spartan.
- Keywords (App Store): referee, Spartan, OCR, obstacle, officiating, rules, training
- Category: Education (Sports as the second category)
- Support URL: the site's address. Support email: one the publisher reads.

**Pictures:**
- Play: the 512×512 icon (`icons/spartanreferee/icon-512.png`), a 1024×500 feature graphic, and at least two phone screenshots.
- App Store: iPhone 6.9-inch screenshots (1320×2868). The app is iPhone-only, so no iPad screenshots are needed.

Neither the feature graphic nor the screenshots exist yet. They can be taken from the site at phone size with the dev server's
example people.

## 5. Risks at review

- **Apple 4.2, "minimum functionality".** Apple rejects apps that are "just a website". In this app's favour: it's a
  members-only tool rather than a marketing site; lessons, rules and the handbook work offline; it films and judges with the
  camera; and it's in 15 languages. If Apple still rejects it, the usual answer is something that only an app can do. Email or
  push reminders for due lessons and new events (already planned) fit best.
- **Apple 4.8, "Sign in with Apple".** Apple asks for it when an app signs in through a third party such as Microsoft. It
  doesn't ask when the accounts are an organisation's own. Say in the review notes that accounts are created by Spartan's
  invitation for its referees only.
- **Google Play's target API level.** New apps and updates must target a recent Android version. Capacitor 8 targets API 36,
  which is fine for 2026 and 2027. Rebuild with a newer Capacitor about once a year.

## 6. Known gaps in the apps

- **Downloads in the Android app.** A file the page makes itself (the CSV in Admin Reports, a person's data export in Manage
  People) doesn't save inside the Android app. Admins can do those in a browser. A fix needs a small piece of native download
  code.
- **No Google sign-in in the apps.** Google blocks its sign-in inside apps, so the apps leave that button out
  (`email-signin-web.js`). People with Google accounts, Spartan's own included, sign in there with an emailed code; Google
  sign-in still works on the website. Proper Google sign-in in the apps needs a native sign-in plugin and its own Google
  client ids for Android and iOS. For the same reason, a Microsoft work account whose organisation signs in through Google
  can't sign in in the apps.
- **Other sites open outside the app.** A server's video review, YouTube's own site, and links to other sites open in the
  phone's browser, which is the right place for the review on a big screen.
- **The iPhone's camera pages** use the page's own camera access. The Android app also has the native camera screen used for
  streaming. Neither has been tried on a real phone yet.
