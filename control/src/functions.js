'use strict';
// The control app: the only thing with rights over the servers. It has one job, once a minute (see reconcile.js).
const { app } = require('@azure/functions');
const { tableStore } = require('./store');
const { reconcile } = require('./reconcile');
const { createArm, health } = require('./arm');

const E = process.env;
const seedFor = (server) => ({
  secret: server.secret, host: server.host, password: server.password, stations: 2, idleMinutes: +E.IDLE_MINUTES || 30, hardHours: +E.HARD_HOURS || 16, maxEngines: 2,
  companyId: server.id, site: `${E.SITE}/console.html`, api: `${E.SITE}/api`, serverKey: server.serverKey, receiverKey: server.receiverKey, bundleUrl: E.BUNDLE_URL,
  brand: null,
});

app.timer('reconcile', {
  schedule: '0 * * * * *',
  handler: async (_timer, context) => {
    const store = tableStore(E.STORAGE_CONNECTION);
    const arm = createArm({ subscription: E.SERVERS_SUBSCRIPTION, group: E.SERVERS_GROUP, region: E.SERVERS_REGION, image: E.SERVERS_IMAGE, subnet: E.SERVERS_SUBNET, nsg: E.SERVERS_NSG, sshKey: E.SERVERS_SSH_KEY });
    // the company's brand goes on the server each time it's first made; afterwards the server asks for it
    const seed = async (server) => {
      const c = await store.get('company', server.id);
      return { ...seedFor(server), brand: c ? { id: c.id, name: c.name, logo: c.logo, theme: c.theme } : null };
    };
    const done = await reconcile({ store, arm, health, seedFor: seed, log: (l) => context.log(l) });
    for (const d of done) if (d.action || d.failed) context.log(JSON.stringify(d));
  },
});
