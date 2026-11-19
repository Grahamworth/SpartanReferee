# Runbook

What to do when something goes wrong, and how to put data back. Every command passes `--subscription 65c0ccca-69f7-43eb-9246-3bd6a6a06b24` (SpartanReferee's subscription); never change the az default.

## Where things are

| What | Where |
|---|---|
| Site and API | Static Web App `spartanreferee` (rg-spartanreferee-uksouth), https://brave-forest-022879f03.3.azurestaticapps.net. `/version.json` shows the commit that's live. |
| Control app (starts, stops and watches camera servers; nightly backup) | Function app `spartanreferee-control` |
| Referee list, admins, assignments, bookings, accounts | Table Storage, account `spartanreferee`, table `spartans` |
| Learning platform | Azure SQL `spartanreferee-sql` / database `learn`, schema `learn` |
| Lesson audio, recordings | Blob containers `learn-media` (7 days), `recordings` |
| Nightly table backups | Blob container `backups`, `tables/YYYY-MM-DD.json.gz`, kept 30 days |
| Errors and alerts | Application Insights `spartanreferee-insights`; alert `spartanreferee-api-failures` emails the action group `spartanreferee-alerts`; budget `spartanreferee-monthly` (£100 a month) |

## Deploying

- Site: commit first, then `bash scripts/deploy-site.sh`. It refuses uncommitted site files, applies any new database migrations, writes `version.json`, and checks the live commit afterwards. The deploy is recorded by that commit in `/version.json`.
- Control app: `bash scripts/deploy-control.sh`.
- Going back: check out the previous commit (`git checkout <commit> -- .`), deploy, then return to `main`. Database migrations only ever add, so an older site runs against a newer database.

## The site is failing

1. Look at Application Insights → Failures (or the alert email) for the error.
2. The learning platform says the database is waking: it sleeps when idle and takes up to a minute to wake; the site retries for about 40 seconds. If it keeps failing, check the database in the portal (it may be paused or out of its monthly allowance; overage billing is on, so it shouldn't stop).
3. A bad deploy: redeploy the previous commit (above).

## Camera servers on event day

- The head referee books from the event page; admins can book, extend or stop any of them from the admin page.
- A server that isn't on 5 minutes after its start: look at the control app's log (Application Insights → Logs, `traces` from `spartanreferee-control`), and at the Azure quota for the server size in Italy North. Stopping and booking again starts a fresh one.
- Stopping by hand when the site can't: delete the VM in `rg-spartanreferee-servers` in the portal. The control app notices on its next minute.

## Restoring the table data (referee list, assignments, bookings)

The control app saves the table every night at 03:30 UTC, except the servers' secrets and Spartan's events (made again or synced again).

1. Find the backup: `az storage blob list --account-name spartanreferee --subscription 65c0ccca-69f7-43eb-9246-3bd6a6a06b24 -c backups --prefix tables/ --query "[].name" -o tsv`
2. Download it: `az storage blob download --account-name spartanreferee --subscription 65c0ccca-69f7-43eb-9246-3bd6a6a06b24 -c backups -n tables/2026-11-20.json.gz -f backup.json.gz`
3. See what's in it: `node scripts/restore-tables.mjs backup.json.gz` (writes nothing). Narrow it with `--only people:spartan,assignment`.
4. Put it back: set `STORAGE_CONNECTION` as the top of `scripts/restore-tables.mjs` shows, and run it again with `--write`. Rows in the backup go back as they were that night; rows added since are left alone.
5. Delete `backup.json.gz` from your PC afterwards: it holds referees' details.

## Restoring the learning database

Azure SQL keeps 7 days of point-in-time backups.

1. Restore to a new database (the old one is untouched): `az sql db restore -g rg-spartanreferee-uksouth -s spartanreferee-sql -n learn --dest-name learn-restore --time 2026-11-20T09:00:00Z --subscription 65c0ccca-69f7-43eb-9246-3bd6a6a06b24`
2. Check it: point `LEARN_SQL_DATABASE` at `learn-restore` in a local shell and open the dev server.
3. Switch the site to it: change the Static Web App setting `LEARN_SQL_DATABASE` to `learn-restore`. The site's own login (`learn_app`) lives inside the database, so the copy has it too.
4. Note that a restored database is a new resource and not on the free offer: delete whichever one you stop using.

## Requests about personal data

See [learning/privacy-draft.md](learning/privacy-draft.md): downloading someone's data, erasing them, and the steps outside the learning platform.
