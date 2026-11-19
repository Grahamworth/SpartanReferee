# Referee Learning & Competence Platform (prototype)

The learning platform lives at **/learn** on the SpartanReferee site (https://brave-forest-022879f03.3.azurestaticapps.net/learn/). It is the prototype asked for in Spartan's *Learning & Competence Platform Prototype Requirements v0.2* (18 November 2026): one person's profile, any number of programmes, lessons, assessments and demonstration credentials, built so a second and third programme need no code change.

Everything in it is a **demonstration**: built on the 2026 baseline documents (not approved 2027 rules), with sample pass policies and invented people. Credentials are watermarked DEMONSTRATION.

| Document | What's in it |
|---|---|
| [architecture.md](architecture.md) | How it fits together, with a diagram and the data model |
| [decisions.md](decisions.md) | The decision record: stack, sign-in, database, media, translation, PDFs, costs |
| [api.md](api.md) | The read API (version 1) for other systems |
| [acceptance.md](acceptance.md) | The brief's 12 acceptance tests: how each passes, and how to show it |
| [backlog.md](backlog.md) | What's left, in priority order |

## Using it

Sign in with Microsoft at /learn. Admins (the site's admins) come in as global admins; referees on the site's referee list come in as learners. The first visit makes your record (your name and address only).

The menu:

| Item | Who | What |
|---|---|---|
| Overview | everyone | your programmes, progress and credentials |
| Programmes | everyone | the catalogue; each programme's curriculum, assessment, policy and handbook |
| My profile | everyone | your details, learning record and credentials |
| Rules | everyone | the rule references lessons and questions cite |
| Reviews | editors, owners, admins | rule changes and disputes waiting for a decision |
| Assessing | assessors, owners, admins | answers waiting for an assessor |
| Reports | admins, owners, coordinators | figures and export, within your scope |
| People, Duplicates, Audit log | admins (People also coordinators) | profiles, possible duplicates, every privileged change |
| Media | admins, programme owners | which media provider plays the lessons |
| Diagnostics | technical admins, admins | database health, migrations, narration use, activity counts and recent errors; nothing personal |

**Preview as** (admins): the bar under the header switches the page to a type of user (Learner / referee, Regional coordinator, Programme owner, Content editor / translator, Assessor, Technical admin, Global admin), each shown by one of the invented people, or to any invented person. The server applies that person's permissions; the audit log records both of you.

### The demonstration people

| Person | Region | Role | Shows |
|---|---|---|---|
| Grace Admin | Europe | Global admin | everything |
| Paul Owner | Americas | Programme owner (OCR) | approving content, rules, review items and credentials |
| Elena Ruiz | Europe | Regional coordinator | Europe only (people, reports, export) |
| Karim Haddad | Middle East and Asia | Regional coordinator | Middle East and Asia only |
| Claire Martin | Europe | Content editor (OCR) | drafting lessons and translations; can't approve |
| Tomas Novak | Europe | Assessor (OCR) | deciding video judgements |
| Anna Kowalska | Europe | Learner | OCR in progress and a DEKA credential: two records, one identity |
| Ben Taylor | Europe | Learner | OCR passed: an active credential |
| Chaiwat Srisuk | Middle East and Asia | Learner | OCR credential due for renewal |
| Daniyal Khan | Middle East and Asia | Learner | DEKA credential expired |
| Sam Okafor | Europe | Technical admin | Diagnostics only: no profiles, answers, audit or reports |

## What's in the demonstration content

- **Spartan OCR Referee 2027**: the nine sections of the 2026 Referee Online Program as nine modules and 22 lessons. One lesson is complete end to end, *Spear Throw: commitment and failure* (rule 4.2.13), in English and in Spanish (a machine translation shown as a Preview translation until reviewed). The rest are shells, shown as "being written".
- **The OCR knowledge check**: eight questions from sections 4 and 6, each citing its 2026 rule numbers, including a video judgement (a burpee with no jump, drawn by the site's own figure) that an assessor confirms.
- **Burpee camera station 2027** (19 November 2026): what was the Cameras guide, now a course every referee can take: four modules, nine complete lessons (how the station works, booking, kit, placing and connecting phones, the AI judge, results, problems), an eight-question check and a demonstration credential. Its last lesson holds the free camera and, for head referees and admins, the only place a 30-minute practice server is booked. Old links to  open it.
- **DEKA Judge (placeholder)**: a sample lesson and quiz with its own pass mark (70%) and credential (24 months), clearly not DEKA material.
- **Rule references**: eleven sections of the 2026 rulebook, and **seven open review items** where the 2026 rulebook, Officiating SOP and online programme disagree. They're shown as "Under review", never quietly resolved.

## Setting it up

The resources (all in the HeadJudge subscription, resource group `rg-spartanreferee-uksouth`):

- Azure SQL server `spartanreferee-sql`, database `learn` (serverless, free offer; it pauses after an hour unused, and the first visit after that takes up to a minute).
- Azure AI Speech `spartanreferee-speech` (F0) for narration.
- The storage account's private `learn-media` container for narration audio.
- The site's app settings `LEARN_SQL_SERVER`, `LEARN_SQL_DATABASE`, `LEARN_SQL_USER`, `LEARN_SQL_PASSWORD`, `LEARN_SPEECH_REGION`, `LEARN_SPEECH_KEY` (secrets only there, never in files).

The database's tables are made by numbered migrations (`api/src/learn/migrations/NNN-*.sql`), applied on the first request. The demonstration data is loaded, safely again and again, by:

```bash
source scripts/learn-env.sh && node scripts/learn-seed.mjs
```

`LEARN_SCHEMA=learn_dev` seeds the copy the local dev server uses. Content lives in `scripts/learn-content.mjs` (programmes), `learn-lessons.mjs` (lesson scripts), `learn-questions.mjs` (questions and demo results) and `learn-rules.mjs` (rule references and disputes).

Locally: `ADMIN_EMAILS=boss@example.com LEARN_FROM_AZ=1 node api/dev-server.js` reads the database and Speech settings from the site with `az` (signed in), uses the `learn_dev` schema, and offers a test sign-in.

## Tests

```bash
cd api && node --test test/*.test.js          # the API, including permissions and AT-12
source scripts/learn-env.sh && cd api && npm run test:sql   # against the real database, in a throwaway schema (learn_test)
node --test tests/*.mjs                       # the site
node scripts/mobile-check.mjs                 # every page at phone width (with the dev server running)
```

The database tests (`api/test/sql/`) cover the acceptance tests: see [acceptance.md](acceptance.md).
