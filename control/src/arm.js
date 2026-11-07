'use strict';
// The few things the control app asks of Azure, with its own identity (no passwords). It only has rights over the servers' resource group.
const API = 'https://management.azure.com';
const COMPUTE = '2024-07-01', NETWORK = '2024-05-01';
const RETRY_TRIES = 8, RETRY_SECONDS = 5, MAX_RETRY_SECONDS = 30;

async function identityToken() {
  const url = `${process.env.IDENTITY_ENDPOINT}?api-version=2019-08-01&resource=${encodeURIComponent(`${API}/`)}`;
  const r = await fetch(url, { headers: { 'X-IDENTITY-HEADER': process.env.IDENTITY_HEADER } });
  if (!r.ok) throw new Error(`No identity token (${r.status})`);
  return (await r.json()).access_token;
}

/** subscription, group, region: where the servers live; image: the prepared server image; subnet, nsg: shared by all servers; sshKey: fixed, nobody holds its private half */
function createArm({ subscription, group, region, image, subnet, nsg, sshKey, size = 'Standard_NC8as_T4_v3', diskGb = 128, token = identityToken, doFetch = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const base = `${API}/subscriptions/${subscription}/resourceGroups/${group}/providers`;
  async function call(method, path, body) {
    for (let attempt = 1; ; attempt += 1) {
      const r = await doFetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      if (r.status === 404) return null;
      const text = await r.text();
      // "Not yet": a new server's network card can't be made until its address is ready, which takes a few seconds.
      if (r.status === 429 && attempt < RETRY_TRIES) { await wait(Math.min(Number(r.headers?.get?.('retry-after')) || RETRY_SECONDS, MAX_RETRY_SECONDS) * 1000); continue; }
      if (!r.ok) throw new Error(`${method} ${path.split('?')[0].split('/').pop()}: ${r.status} ${text.slice(0, 1000)}`);
      return text ? JSON.parse(text) : {};
    }
  }
  return {
    async power(vm) {
      const v = await call('GET', `/Microsoft.Compute/virtualMachines/${vm}/instanceView?api-version=${COMPUTE}`);
      if (!v) return 'none';
      const s = (v.statuses || []).find((x) => /^PowerState\//.test(x.code))?.code.split('/')[1];
      const busy = (v.statuses || []).some((x) => /^ProvisioningState\/(creating|updating)/.test(x.code));
      if (!s) return 'starting';
      return s === 'running' ? 'running' : s === 'starting' ? 'starting' : s === 'deallocated' ? 'deallocated' : s === 'deallocating' || s === 'stopping' ? 'stopping' : busy ? 'starting' : s === 'stopped' ? 'stopped' : 'other';
    },
    async create(server, seed) {
      const tags = { project: 'headjudge', company: server.id };
      const pip = await call('PUT', `/Microsoft.Network/publicIPAddresses/${server.vm}-ip?api-version=${NETWORK}`, { location: region, tags, sku: { name: 'Standard' }, properties: { publicIPAllocationMethod: 'Static', dnsSettings: { domainNameLabel: server.label } } });
      const nic = await call('PUT', `/Microsoft.Network/networkInterfaces/${server.vm}-nic?api-version=${NETWORK}`, { location: region, tags, properties: { networkSecurityGroup: { id: nsg }, ipConfigurations: [{ name: 'main', properties: { subnet: { id: subnet }, publicIPAddress: { id: pip.id } } }] } });
      await call('PUT', `/Microsoft.Compute/virtualMachines/${server.vm}?api-version=${COMPUTE}`, {
        location: region, tags,
        properties: {
          hardwareProfile: { vmSize: size },
          storageProfile: { imageReference: { id: image }, osDisk: { createOption: 'FromImage', diskSizeGB: diskGb, managedDisk: { storageAccountType: 'StandardSSD_LRS' }, deleteOption: 'Detach' } },
          osProfile: { computerName: server.vm.slice(0, 60), adminUsername: 'azureuser', linuxConfiguration: { disablePasswordAuthentication: true, ssh: { publicKeys: [{ path: '/home/azureuser/.ssh/authorized_keys', keyData: sshKey }] } } },
          networkProfile: { networkInterfaces: [{ id: nic.id, properties: { deleteOption: 'Detach' } }] },
          securityProfile: { securityType: 'TrustedLaunch', uefiSettings: { secureBootEnabled: false, vTpmEnabled: true } },
          userData: Buffer.from(JSON.stringify(seed)).toString('base64'),
        },
      });
    },
    async listRunning() {
      const r = await call('GET', `/Microsoft.Compute/virtualMachines?api-version=${COMPUTE}&statusOnly=true`);
      return (r?.value || []).filter((v) => (v.properties?.instanceView?.statuses || []).some((x) => x.code === 'PowerState/running')).map((v) => v.name);
    },
    start: (vm) => call('POST', `/Microsoft.Compute/virtualMachines/${vm}/start?api-version=${COMPUTE}`),
    deallocate: (vm) => call('POST', `/Microsoft.Compute/virtualMachines/${vm}/deallocate?api-version=${COMPUTE}`),
  };
}

async function health(host, doFetch = fetch) {
  try { const r = await doFetch(`https://${host}/healthz`, { signal: AbortSignal.timeout(6000) }); return r.ok; } catch { return false; }
}

module.exports = { createArm, health };
