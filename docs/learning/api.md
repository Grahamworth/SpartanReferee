# Read API, version 1

For other systems (event assignment, officiating, AI review) to read a person's programmes and credentials, and the current version of a rule (INT-01). Read only. Every answer carries `apiVersion: "v1"`; fields in v1 won't be renamed or removed, only added to. A breaking change would be `/v2`.

**Address**: `https://brave-forest-022879f03.3.azurestaticapps.net/api/learn/v1/...`

**Sign-in and scope**: the same as the site (the `X-Session` header from Microsoft sign-in), and the same scopes: a person sees their own records; a regional coordinator, people in their regions; a programme owner, their programme's credentials; an admin, everything. Anything outside the caller's scope answers 404, as if it didn't exist. A service account for machine-to-machine calls is on the [backlog](backlog.md).

## People

`GET /api/learn/v1/people/{id}`, where `{id}` is the person's UUID or SR number (SR-000123):

```json
{ "apiVersion": "v1",
  "person": { "id": "…", "publicId": "SR-000007", "name": "Anna Kowalska", "regionId": "europe", "country": "PL", "status": "active", "invented": true,
              "programmeRoles": [ { "programmeId": "ocr-referee", "role": "OCR Referee", "grade": "Trainee", "status": "active" } ] } }
```

`GET /api/learn/v1/people/{id}/enrolments`:

```json
{ "apiVersion": "v1",
  "enrolments": [ { "id": "…", "programmeId": "ocr-referee", "edition": "2027", "versionId": "…", "state": "completed",
                    "enrolledAt": "…", "completedAt": "…", "progress": { "lessons": 1, "done": 1 } } ] }
```

`state` is `active`, `completed` or `withdrawn`. `progress` counts lessons with published content.

`GET /api/learn/v1/people/{id}/credentials`:

```json
{ "apiVersion": "v1",
  "credentials": [ { "id": "…", "publicId": "DEMO-OCR-000002", "programmeId": "ocr-referee", "edition": "2027", "qualification": "OCR Referee 2027",
                     "status": "due", "valid": true, "issuedAt": "…", "expiresAt": "…", "demonstration": true } ] }
```

## Credentials

`GET /api/learn/v1/credentials/{id}`, where `{id}` is the UUID or the public id (DEMO-OCR-000002): is this credential valid, now?

```json
{ "apiVersion": "v1",
  "credential": { "id": "…", "publicId": "DEMO-OCR-000002", "personPublicId": "SR-000008", "programmeId": "ocr-referee", "edition": "2027",
                  "qualification": "OCR Referee 2027", "status": "active", "valid": true, "issuedAt": "…", "expiresAt": "…", "demonstration": true } }
```

`status` is `active`, `due` (inside the renewal window), `expired`, `suspended`, `superseded` or `revoked`. `valid` is true for `active` and `due`. In this prototype every credential has `demonstration: true` and must not be relied on for real officiating.

## Rules

`GET /api/learn/v1/rules/{ruleId}`: the current approved version of a rule reference.

```json
{ "apiVersion": "v1",
  "rule": { "id": "OCR-2026-4.2.13", "versionNo": 1, "section": "4.2.13", "title": "Spear Throw", "excerpt": "…",
            "document": "Spartan OCR Rules of Competition 2026", "documentApproval": "baseline", "effectiveDate": "2026-01-01" } }
```

`documentApproval` is `baseline` for the 2026 documents: not approved 2027 rules.

## Personal data (not part of v1)

The site's own pages use these; they're listed here because they're the procedure in [privacy-draft.md](privacy-draft.md).

- `GET /api/learn/people/{id}/export`: everything held about one person (their record, logins, roles, enrolments, progress, attempts, credentials and the audit entries about them), as JSON. The person themselves, or an admin. Audited as `person.export`.
- `POST /api/learn/people/{id}/erase` with `{ "confirm": "ERASE" }`: an admin, as themselves (not viewing as someone), and not their own record. Replaces the name and email, removes the country, sign-in links, roles and lesson progress, and sets the status to `erased` so they can't sign in. Their attempts and credentials stay, anonymised. Audited as `person.erase`. Older audit entries that mention the address are cleaned by `scripts/learn-erase.mjs`.

## Errors

`401` not signed in; `403` signed in but not in the organisation; `404` no such thing, or not in your scope; `503` the database is waking up (try again in a minute). Errors are `{ "apiVersion": "v1", "error": "…" }` where the API version is known.
