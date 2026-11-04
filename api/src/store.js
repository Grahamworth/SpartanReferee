'use strict';
/* Where the backend keeps things: get / put / remove one value by (part, key), list a part.
   memoryStore() for tests and running locally; tableStore() on Azure Table Storage (one table, the value as JSON). */

function memoryStore() {
  const m = new Map();
  const k = (p, key) => p + '\u0000' + key;
  return {
    async get(p, key) { const v = m.get(k(p, key)); return v === undefined ? null : JSON.parse(v); },
    async put(p, key, v) { m.set(k(p, key), JSON.stringify(v)); },
    async remove(p, key) { m.delete(k(p, key)); },
    async list(p) { const out = []; for (const [kk, v] of m) if (kk.startsWith(p + '\u0000')) out.push(JSON.parse(v)); return out; },
  };
}

function tableStore(connection, tableName = 'spartans') {
  const { TableClient } = require('@azure/data-tables');
  const t = TableClient.fromConnectionString(connection, tableName);
  let ready = null;
  const init = () => (ready = ready || t.createTable().catch((e) => { if (e.statusCode !== 409) { ready = null; throw e; } }));
  const esc = (s) => String(s).replace(/[/\\#?]/g, '_');
  return {
    async get(p, key) {
      await init();
      try { return JSON.parse((await t.getEntity(esc(p), esc(key))).data); } catch (e) { if (e.statusCode === 404) return null; throw e; }
    },
    async put(p, key, v) { await init(); await t.upsertEntity({ partitionKey: esc(p), rowKey: esc(key), data: JSON.stringify(v) }, 'Replace'); },
    async remove(p, key) { await init(); try { await t.deleteEntity(esc(p), esc(key)); } catch (e) { if (e.statusCode !== 404) throw e; } },
    async list(p) {
      await init();
      const out = [];
      for await (const e of t.listEntities({ queryOptions: { filter: `PartitionKey eq '${esc(p).replace(/'/g, "''")}'` } })) out.push(JSON.parse(e.data));
      return out;
    },
  };
}

module.exports = { memoryStore, tableStore };
