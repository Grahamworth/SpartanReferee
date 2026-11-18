// Reports (step 6): each programme's and region's enrolments, lessons completed, results and credentials, the credentials due or
// expired, and an export; scoped on the server to what this person may see (ADM-01, ADM-02, AT-10).
import { $, call, esc, toast, badge, day, act } from './core.js';

const CRED = [['active', 'Active'], ['due', 'Due'], ['expired', 'Expired'], ['suspended', 'Suspended'], ['revoked', 'Revoked']];
const tile = (n, label) => `<div class="tile2"><b>${n}</b><span>${esc(label)}</span></div>`;
function credBar(c) {
  const total = CRED.reduce((n, [k]) => n + (c[k] || 0), 0);
  if (!total) return '<p class="note">No credentials yet.</p>';
  return `<div class="stackBar" role="img" aria-label="${esc(CRED.filter(([k]) => c[k]).map(([k, l]) => `${c[k]} ${l.toLowerCase()}`).join(', '))}">${CRED.filter(([k]) => c[k]).map(([k]) => `<span class="sb-${k}" style="flex:${c[k]}"></span>`).join('')}</div>
    <p class="legend">${CRED.filter(([k]) => c[k]).map(([k, l]) => `<span><i class="sb-${k}"></i>${l} ${c[k]}</span>`).join('')}</p>`;
}

async function reportsView() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const d = await call(`reports?${new URLSearchParams([...(q.get('programme') ? [['programme', q.get('programme')]] : []), ...(q.get('region') ? [['region', q.get('region')]] : [])])}`);
  const scope = d.scope.all ? 'Everything' : [d.scope.programmes.length ? `programme ${d.scope.programmes.join(', ')}` : '', d.scope.regions.length ? `people in ${d.scope.regions.join(', ')}` : ''].filter(Boolean).join(' and ');
  return `<section class="card"><h1>Reports</h1><p class="note">What you can see: ${esc(scope)}. Every figure and the export stay within it.</p>
      <form class="filters2" id="reportFilter"><select name="programme" aria-label="Programme"><option value="">All programmes</option>${d.options.programmes.map((p) => `<option value="${esc(p.id)}"${d.filters.programme === p.id ? ' selected' : ''}>${esc(p.title)}</option>`).join('')}</select>
        <select name="region" aria-label="Region"><option value="">All regions</option>${d.options.regions.map((r) => `<option value="${esc(r.id)}"${d.filters.region === r.id ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
        <button class="small" type="submit">Show</button></form>
      <div class="btnRow"><button class="small" type="button" id="exportCsv">Export as CSV</button><a class="btnLink" href="#/audit?entityType=credential">Who issued or changed credentials</a></div></section>
    ${d.programmes.map((p) => `<section class="card"><h2>${esc(p.title)}</h2>
      <div class="tiles2">${tile(p.enrolled, 'enrolled')}${tile(p.active || 0, 'in progress')}${tile(p.completed || 0, 'completed')}${tile(p.lessonsCompleted, 'lessons completed')}${tile(p.passed, 'passed')}${tile(p.failed, 'not passed')}${tile(p.pending, 'with an assessor')}</div>
      <h3 class="sub">Credentials</h3>${credBar(p.credentials)}</section>`).join('') || '<section class="card"><p class="muted">Nothing to show for these filters.</p></section>'}
    ${d.regions.length ? `<section class="card"><h2>By region</h2><div class="tableWrap"><table class="auditTable"><thead><tr><th>Region</th><th>Enrolled</th><th>Completed</th><th>Passed</th><th>Not passed</th><th>Active</th><th>Due</th><th>Expired</th></tr></thead><tbody>
      ${d.regions.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.enrolled}</td><td>${r.completed || 0}</td><td>${r.passed}</td><td>${r.failed}</td><td>${r.credentials.active || 0}</td><td>${r.credentials.due || 0}</td><td>${r.credentials.expired || 0}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
    <section class="card"><h2>Due for renewal or expired</h2><ul class="rowList">${d.expiring.map((c) => `<li><a href="#/credential/${esc(c.id)}"><b>${esc(c.person)} · ${esc(c.programme)}</b><small>${esc(c.personPublicId)} · ${esc(c.region)} · ${esc(c.publicId)} · ${c.status === 'expired' ? 'expired' : 'expires'} ${esc(day(c.expiresAt))}</small></a>${badge(c.status)}</li>`).join('') || '<li class="muted">None.</li>'}</ul></section>`;
}

export const views = { reports: reportsView };

export function wire() {
  $('reportFilter')?.addEventListener('submit', (e) => { e.preventDefault(); location.hash = `#/reports?${new URLSearchParams([...new FormData(e.target)].filter(([, v]) => v))}`; });
  $('exportCsv')?.addEventListener('click', (e) => act(async () => {
    const q = location.hash.split('?')[1] || '';
    const r = await call(`reports/export${q ? `?${q}` : ''}`);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv' })); a.download = r.filename; a.click(); URL.revokeObjectURL(a.href);
    toast(`Exported ${r.rows} rows`);
  }, e.currentTarget));
}
