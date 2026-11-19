// Diagnostics, for the technical administrator and global admins: is the database reachable and up to date, how much narration
// has been made today, what's been happening (as counts) and this server's recent errors. No names, addresses or answers.
import { $, call, esc, badge, when, redraw, act } from './core.js';

const tile = (n, label) => `<div class="tile2"><b>${esc(n)}</b><span>${esc(label)}</span></div>`;
const LABEL = { person: 'people', person_login: 'sign-in links', role_grant: 'roles given', region: 'regions', programme: 'programmes', programme_version: 'editions',
  module: 'modules', lesson: 'lessons', enrolment: 'enrolments', lesson_progress: 'lessons in progress', completion: 'lessons completed', content_version: 'lesson versions',
  question: 'questions', assessment: 'assessments', attempt: 'attempts', credential: 'credentials', rule_ref: 'rule references', rule_link: 'rule links',
  review_item: 'review items', media_asset: 'narration clips', audit_event: 'audit entries' };

async function diagnosticsView() {
  const [d, version] = await Promise.all([call('diagnostics'), fetch('../version.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
  const db = d.database, n = d.narration, pct = Math.min(100, Math.round((100 * n.last24hChars) / n.dailyLimit));
  const pending = d.migrations.pending;
  return `<section class="card"><h1>Diagnostics</h1>
      <p class="note">Counts, settings and times only: nothing here names anyone or shows their answers. Checked ${esc(when(d.checkedAt))}.</p>
      <div class="tiles2">${tile(version?.commit || '?', 'version live')}${tile(db.ok ? 'OK' : 'Down', 'database')}${tile(`${db.roundTripMs} ms`, 'database answer')}${tile(pending.length ? pending.length : 'None', 'changes waiting')}${tile(d.errors.length, 'recent errors')}</div>
      <div class="btnRow"><button class="small" type="button" id="diagRefresh">Check again</button></div></section>
    <section class="card"><h2>Database</h2>
      <ul class="rowList">
        <li><span><b>${esc(db.name)} · schema ${esc(db.schema)}</b><small>${esc(db.edition)} ${esc(db.tier)} · signed in as ${esc(db.login)}</small></span>${badge(db.login === 'dbo' ? 'due' : 'active', db.login === 'dbo' ? 'admin login' : 'restricted')}</li>
        <li><span><b>${d.migrations.applied.length} changes applied</b><small>latest ${esc(d.migrations.applied.at(-1)?.name || 'none')}, ${esc(when(d.migrations.applied.at(-1)?.at))}</small></span>${badge(pending.length ? 'due' : 'active', pending.length ? 'waiting' : 'up to date')}</li>
        ${pending.length ? `<li><span><b>Waiting: ${esc(pending.join(', '))}</b><small>The deploy script applies these with the admin login.</small></span></li>` : ''}
        <li><span><b>Woke from sleep ${d.instance.wakingAnswers} ${d.instance.wakingAnswers === 1 ? 'time' : 'times'}</b><small>answers that asked someone to try again in a minute, since this server started ${esc(when(d.instance.startedAt))}</small></span></li>
      </ul></section>
    <section class="card"><h2>Narration</h2>
      <ul class="rowList">
        <li><span><b>Azure AI Speech</b><small>${n.azureSpeech ? `set up, ${esc(n.region)}` : 'not set up: devices read narration aloud themselves'}${n.storage ? '' : ' · no audio storage'}</small></span>${badge(n.azureSpeech && n.storage ? 'active' : 'due', n.azureSpeech && n.storage ? 'on' : 'off')}</li>
        <li><span><b>${n.last24hChars.toLocaleString()} of ${n.dailyLimit.toLocaleString()} characters in the last 24 hours</b><small>${n.clips} clips kept, ${n.totalChars.toLocaleString()} characters in all. Past the limit, lessons fall back to the device's voice.</small></span></li>
      </ul>
      <span class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${pct}% of today's narration used"><span style="width:${pct}%"></span></span>
      ${n.providers.length ? `<p class="note">Settings: ${n.providers.map((p) => `${esc(p.scope)} ${esc(p.provider)}`).join(' · ')}</p>` : ''}</section>
    <section class="card"><h2>Last ${d.activity.days} days</h2>
      <div class="tiles2">${tile(d.activity.activePeople, 'people active')}${tile(d.activity.actions.reduce((s, a) => s + a.n, 0), 'recorded changes')}</div>
      <div class="tableWrap"><table class="auditTable"><thead><tr><th>What</th><th>How many</th><th class="hideSmall">Last</th></tr></thead><tbody>
      ${d.activity.actions.map((a) => `<tr><td>${esc(a.action)}</td><td>${a.n}</td><td class="hideSmall">${esc(when(a.last))}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nothing recorded.</td></tr>'}
      </tbody></table></div></section>
    <section class="card"><h2>Records</h2>
      <div class="tiles2">${Object.entries(d.tables).map(([t, c]) => tile(c.toLocaleString(), LABEL[t] || t)).join('')}</div>
      <p class="note">People: ${d.people.map((p) => `${p.n} ${esc(p.status)}${p.invented ? ' invented' : ' real'}`).join(' · ') || 'none'}.</p></section>
    <section class="card"><h2>Recent errors</h2>
      <p class="note">On this server since ${esc(when(d.instance.startedAt))}, newest first, with ids and addresses hidden. The full log is in Application Insights.</p>
      <ul class="rowList">${d.errors.map((e) => `<li><span><b>${esc(e.error)}</b><small>${esc(e.request)} · ${esc(when(e.at))}</small></span></li>`).join('') || '<li class="muted">None.</li>'}</ul></section>`;
}

export const views = { diagnostics: diagnosticsView };
export function wire() {
  const b = $('diagRefresh'); if (b) b.onclick = () => act(async () => redraw(), b);
}
