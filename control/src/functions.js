'use strict';
// The control app: the only thing with rights over the servers. It has one job, once a minute (see reconcile.js).
const { app } = require('@azure/functions');
const { tableStore } = require('./store');
const { reconcile } = require('./reconcile');
const { backup } = require('./backup');
const { createArm, health } = require('./arm');
const cameraSplit = require('./cameras'); // api/src/cameras.js, copied in when this is published

const E = process.env;
const seedFor = (server) => ({
  secret: server.secret, host: server.host, password: server.password, stations: 2, maxCameras: 2, maxEngines: 2, idleMinutes: 0, hardHours: 0,
  companyId: server.company || server.id, site: `${E.SITE}/console.html`, api: `${E.SITE}/api`, serverKey: server.serverKey, receiverKey: server.receiverKey, bundleUrl: E.BUNDLE_URL,
  brand: null,
});
// how many of the booking's cameras it has, and the number its first goes by (the same rule as the site's). The server asks the site
// again each time it starts, so this only saves it showing the wrong ones for a moment.
const bookedOn = (server, want) => {
  const { cameras, first } = cameraSplit.bookedOn(server.n, want?.bookedCameras);
  return { stations: cameras, bookedCameras: cameras, firstCamera: first };
};

// every night at 03:30 UTC: the site's table data to the private backups container, kept 30 days (backup.js)
app.timer('backup', {
  schedule: '0 30 3 * * *',
  handler: async (_timer, context) => {
    const { TableClient } = require('@azure/data-tables');
    const table = TableClient.fromConnectionString(E.STORAGE_CONNECTION, 'spartans');
    const r = await backup({ connection: E.STORAGE_CONNECTION, listEntities: () => table.listEntities() });
    context.log(`backup: ${r.name}, ${r.rows} rows, ${r.bytes} bytes${r.removed ? `; removed ${r.removed}` : ''}`);
  },
});

app.timer('reconcile', {
  schedule: '0 * * * * *',
  handler: async (_timer, context) => {
    const store = tableStore(E.STORAGE_CONNECTION);
    const arm = createArm({ subscription: E.SERVERS_SUBSCRIPTION, group: E.SERVERS_GROUP, region: E.SERVERS_REGION, image: E.SERVERS_IMAGE, subnet: E.SERVERS_SUBNET, nsg: E.SERVERS_NSG, sshKey: E.SERVERS_SSH_KEY });
    // the company's brand goes on the server each time it's first made; afterwards the server asks for it
    const seed = async (server) => {
      const [c, want] = await Promise.all([store.get('company', server.company || server.id), store.get('serverwant', server.id)]);
      return { ...seedFor(server), ...bookedOn(server, want), brand: c ? { id: c.id, name: c.name, logo: c.logo, theme: c.theme } : null };
    };
    const done = await reconcile({ store, arm, health, seedFor: seed, log: (l) => context.log(l) });
    for (const d of done) if (d.action || d.failed) context.log(JSON.stringify(d));
  },
});
