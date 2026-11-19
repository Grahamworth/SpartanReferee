// Puts rows from a nightly backup (control/src/backup.js) back into the site's table. Shows what it would do unless given --write.
// Only rows in the backup are touched: each is written back as it was that night; rows made since are left alone.
//   az storage blob download --account-name spartanreferee --subscription 65c0ccca-69f7-43eb-9246-3bd6a6a06b24 -c backups -n tables/2026-11-20.json.gz -f backup.json.gz
//   STORAGE_CONNECTION="$(az storage account show-connection-string -n spartanreferee --subscription 65c0ccca-69f7-43eb-9246-3bd6a6a06b24 -o tsv)" \
//     node scripts/restore-tables.mjs backup.json.gz [--only people:spartan,assignment] [--write]
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../api/package.json', import.meta.url));
const { TableClient } = require('@azure/data-tables');
const args = process.argv.slice(2), file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--only');
const only = (args[args.indexOf('--only') + 1] || '').split(',').filter((s) => args.includes('--only') && s);
const write = args.includes('--write');
if (!file) { console.log('Usage: node scripts/restore-tables.mjs backup.json.gz [--only partition,partition] [--write]'); process.exit(2); }
const rows = JSON.parse(gunzipSync(readFileSync(file))).filter((r) => !only.length || only.some((p) => r.partitionKey === p || r.partitionKey.startsWith(`${p}:`)));
const count = {};
for (const r of rows) { const k = r.partitionKey.split(':')[0]; count[k] = (count[k] || 0) + 1; }
console.log(`${rows.length} rows in ${file}${only.length ? ` (only ${only.join(', ')})` : ''}:`, count);
if (!write) { console.log('Nothing written: add --write to put them back.'); process.exit(0); }
if (!process.env.STORAGE_CONNECTION) { console.log('Set STORAGE_CONNECTION first (see the top of this script).'); process.exit(2); }
const table = TableClient.fromConnectionString(process.env.STORAGE_CONNECTION, 'spartans');
let n = 0;
for (const r of rows) { await table.upsertEntity({ partitionKey: r.partitionKey, rowKey: r.rowKey, data: r.data }, 'Replace'); n++; }
console.log(`Wrote ${n} rows back.`);
