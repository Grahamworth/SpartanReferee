# Decision record

Decisions made building the prototype (brief section 12), with the reason and what would change them. Costs are approximate and from published list prices as remembered; confirm before relying on them.

## 1. Native web delivery, no LMS runtime

**Decision**: build the learning area as part of the existing site (`/learn`), with its own lessons, player, assessments and records. No SCORM, xAPI or Docebo runtime.

**Why**: the brief asks for programme independence, versioned rule links and per-programme credentials, which a SCORM package can't express, and wants records exportable. The site already has hosting, sign-in and an API. Content stays exportable: lessons are JSON, the handbook is a PDF, and records come out through the CSV export and the read API.

**Would change if**: Spartan must keep Docebo as the system of record. Then this becomes the authoring and delivery front end, with completions pushed to Docebo (MIG-01).

## 2. Sign-in: the site's Microsoft sign-in

**Decision**: the same Microsoft sign-in as the rest of the site. A person is tied to a login by `person_login` (provider and subject), never by email. Admins come in as global admins; referees on the site's list as learners.

**Why**: one account for referees across the site; the email is not a key (PER-01).

**Note**: opening `/learn` to real referees (19 November 2026) means real records with a name and an email address, beyond the brief's "synthetic data only" (NFR-04). Everyone else in the demonstration is invented. This needs Spartan's privacy decisions before any wider use (NFR-07).

## 3. Database: Azure SQL, serverless, free offer

**Decision**: Azure SQL Database (serverless, free offer, UK South), in its own schema per use (`learn` live, `learn_dev` local, `learn_test` tests), with numbered migrations.

**Why**: relational records with transactions and constraints suit identity, enrolments, attempts and credentials (the brief: relational storage for records). The free offer covers a demonstrator (about 100,000 vCore seconds and 32 GB a month), and it pauses when unused.

**Trade-off**: after an hour unused it pauses, and the first request takes up to a minute to wake it. The API retries for about 30 seconds, then asks to try again. A production database would be provisioned (from about £4 a month for the smallest).

## 4. Media: narrated slides, through a replaceable adapter

**Decision**: lessons are slides with a narration script. The media adapter (`api/src/learn/media.js`) turns a content version into something to play, by provider:

| Provider | What plays | Cost | Lock-in |
|---|---|---|---|
| Azure AI Speech (default) | a neural voice per language, made once per slide and kept in blob storage | free tier 0.5 million characters a month; the whole demo lesson in two languages is under 6,000 | low: the script is ours, any voice service can replace it |
| Device voice | the browser reads the script (Web Speech API) | free | none; quality varies by device |
| Captions only | captions and transcript | free | none |

**Why** (the design doc's comparison): narration regenerates in minutes when a rule changes; an avatar video is slower and costlier to redo and adds little to obstacle rules, which are best shown with real footage. Captions and a transcript are always there (LRN-05, NFR-03).

**Avatar presenter**: not trialled, as it needs a vendor account and spend. It would be one more provider in the adapter returning a video, with no change to lessons or completions (AT-11 shows a swap). Vendors are typically priced per seat or per minute; compare on languages, API access and re-render cost.

## 5. Translation: English master, reviewed translations

**Decision**: English is the master. A translation is its own content version pointing at the English it translates, with who made it. Until approved, learners see it marked **Preview translation**, and a lesson done only in a preview doesn't count towards a credential (NFR-06).

**Pilot language**: Spanish, as a machine translation by Claude, not reviewed. The design doc suggests Spanish (most events outside the US) or French (World Championship countries); the officiating lead chooses, and a native-speaker reviewer approves.

## 6. The handbook and certificates: made in the browser

**Decision**: the API returns the published programme (or credential) as data; the page makes the PDF with jsPDF, stamped with programme, edition, language, approval state and date. Downloads are audited.

**Why**: no PDF engine in the Functions; the data is the controlled source. A production system might render server side for a fixed archive copy.

## 7. Video judgement items: the site's own animation

**Decision**: the video judgement question shows a burpee drawn by the site's animated figure (`tracked-demos.js`), done right or with one fault.

**Why**: no rights-cleared footage was available (the brief: no third-party video without permission), and the figure is ours. Real obstacle tutorial clips can replace it once their use is cleared.

## 8. Rules and disputes

**Decision**: rule references are versioned, approved by someone other than their author, and cited by id from lessons and questions. A draft change raises a review item listing everything it affects; nothing published changes by itself. Where the 2026 sources disagree, an open review item says so (seven of them), and the lesson and questions show "Under review".

**Why**: RUL-01 to RUL-04, and the brief's instruction not to represent unapproved 2027 rules as official.

## 9. Scope on the server

Every read and write is checked on the server by role, programme and region; the page only hides links for tidiness. Reports and exports are built with the same scope in the query, so a coordinator's export can't include another region (ADM-02, NFR-01).

## Running costs (approximate)

| Item | Demonstration | Notes |
|---|---|---|
| Static Web App and Functions | already paid for by the site | |
| Azure SQL serverless | £0 within the free offer | about £4 a month and up provisioned |
| Azure AI Speech | £0 on F0 | about $16 per million characters on standard: a nine-module course in 15 languages is a few dollars |
| Blob storage | pennies | narration audio |
