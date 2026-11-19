// What every part of the learning page shares: the signed-in person (S.me), the regions, calling the API, messages and small helpers.
// Each area (people.js, programmes.js, lesson.js, assess.js, govern.js, reports.js, cameras.js) exports its views and a wire().
import { esc } from '../api-base.js';

export { esc };
export const $ = (id) => document.getElementById(id);
export const show = (el, on) => { if (el) el.hidden = !on; };
const API = location.protocol.startsWith('http') && (location.hostname.endsWith('azurestaticapps.net') || location.port === '8795') ? '/api' : 'https://brave-forest-022879f03.3.azurestaticapps.net/api';
export const store = { get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* private mode */ } } };
export const AS_KEY = 'sr_learn_as';
export const ROLE = { global_admin: 'Global admin', programme_owner: 'Programme owner', regional_coordinator: 'Regional coordinator', content_editor: 'Content editor', assessor: 'Assessor', technical_admin: 'Technical admin' };
export const LANG = { en: 'English', fr: 'Français', de: 'Deutsch', nl: 'Nederlands', es: 'Español', it: 'Italiano', el: 'Ελληνικά', hr: 'Hrvatski', cs: 'Čeština', pl: 'Polski', fi: 'Suomi', sv: 'Svenska', da: 'Dansk', ar: 'العربية', th: 'ไทย' };
/** the page's state: who's signed in (and who they're viewing as), and the regions */
/** a text in the page's language (i18n.js), for what isn't on the page itself: dialog boxes */
export const t = (text, values) => (window.SR_I18N ? window.SR_I18N.t(text, values) : text);
export const S = { me: null, regions: [] };

export async function call(path, { method = 'GET', body } = {}) {
  const headers = { 'X-Session': store.get('sp_token') };
  if (store.get(AS_KEY)) headers['X-Learn-As'] = store.get(AS_KEY);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${API}/learn/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null; try { data = await r.json(); } catch { /* empty */ }
  if (!r.ok) { const e = new Error((data && data.error) || `Couldn't reach the server (${r.status})`); e.status = r.status; throw e; }
  return data;
}
export const fail = (msg) => { $('error').textContent = msg || ''; show($('error'), !!msg); if (msg) $('error').scrollIntoView({ block: 'nearest' }); };
export const toast = (s) => { const t = $('toast'); t.textContent = s; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600); };
export const has = (role, where = {}) => S.me.grants.some((g) => g.role === role && (!where.programmeId || !g.programmeId || g.programmeId === where.programmeId));
export const isAdmin = () => has('global_admin');
export const regionName = (id) => S.regions.find((r) => r.id === id)?.name || id || 'No region';
export const roleText = (g) => `${ROLE[g.role] || g.role}${g.programmeId ? ` · ${g.programmeId}` : ''}${g.regionId ? ` · ${regionName(g.regionId)}` : ''}`;
export const when = (t) => (t ? new Date(t).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const day = (t) => (t ? new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric', ...(/^\d{4}-\d{2}-\d{2}(T00:00:00(\.000)?Z)?$/.test(String(t)) ? { timeZone: 'UTC' } : {}) }) : '');
export const formBody = (form) => Object.fromEntries([...new FormData(form)].filter(([, v]) => v !== ''));
/** a version's or a credential's state, as a coloured label */
const STATE_LABEL = { draft: 'Draft', review: 'In review', published: 'Published', superseded: 'Superseded', archived: 'Archived', active: 'Active', due: 'Due for renewal', expired: 'Expired', suspended: 'Suspended', revoked: 'Revoked', completed: 'Completed', withdrawn: 'Withdrawn', pass: 'Passed', fail: 'Not passed', pending: 'Awaiting assessor', approved: 'Approved', open: 'Open', resolved: 'Resolved', preview: 'Preview translation', under_review: 'Under review' };
export const badge = (state, text) => `<span class="badge s-${esc(state)}">${esc(text || STATE_LABEL[state] || state)}</span>`;
/** a progress bar: done of total */
export const bar = (done, total) => { const pct = total ? Math.round((100 * done) / total) : 0; return `<span class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${pct}% done"><span style="width:${pct}%"></span></span>`; };
/** after a change: redraw the current view */
export const redraw = () => window.dispatchEvent(new Event('learn:redraw'));
/** runs fn, showing its error if it fails; buttons inside are disabled meanwhile */
export async function act(fn, btn) {
  if (btn) btn.disabled = true;
  try { fail(''); return await fn(); } catch (e) { fail(e.message); return null; } finally { if (btn) btn.disabled = false; }
}
/** later areas add sections to pages drawn by earlier ones: each is async (data) -> html. programme: a programme's page (its data);
 *  record: a person's learning record (the record); lesson: the end of a lesson (the lesson) */
export const hooks = { programme: [], record: [], lesson: [], wire: [] };
export const runHooks = async (list, data) => (await Promise.all(list.map((f) => f(data)))).join('');
/** jsPDF, loaded the first time a PDF is made (certificates, the handbook) */
let jspdf = null;
export const loadPdf = () => (jspdf = jspdf || new Promise((res, rej) => {
  if (window.jspdf?.jsPDF) { res(window.jspdf.jsPDF); return; } // already here
  const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  s.onload = () => res(window.jspdf.jsPDF); s.onerror = () => { jspdf = null; rej(new Error('The PDF maker couldn\'t load: check the connection')); }; document.head.append(s);
}));
