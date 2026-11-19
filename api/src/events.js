'use strict';
/* Spartan's events, kept here so referees can book cameras for one. Synced when the copy here is more than SYNC_HOURS old and someone
   asks for the list, or when an admin presses Sync now. Two of Spartan's own services, neither a published API, so a change on
   Spartan's side can stop the sync: the last good copy is kept, and the admin area says when it last worked.
     LIST   every upcoming race worldwide, as Spartan's "Find a race" page lists them (country codes, no timezones)
     TIMES  the same races with each one's timezone, from Spartan's race pages; it has been seen to leave out the next few weeks'
            races, so it's only used for timezones. A race it doesn't have gets one from its country (and, in countries with several,
            its longitude), else a whole-hour guess from the longitude.
   GET  /api/events               -> { events, syncedAt, error }   everyone in the organisation: events that haven't finished
   POST /api/admin/events/sync    -> { events, syncedAt, error }   admins: sync now

   Cameras for an event run between 07:00 and 18:00 local time on each of its days (EVENT_DAY): windows() works those out.
     event:<id>  { id, name, brand, city, country, tz, offsetGuess, startDate, endDate, url, syncedAt }
     settings:eventsync  { at, ok, count, error } */
const LIST = 'https://api-gate.eks.spartan.com/one/v2/races/upcoming';
const TIMES = 'https://api2.spartan.com/api/races/upcoming_past_planned';
const SYNC_HOURS = 6, MAX_PAGES = 30, KEEP_DAYS_AFTER = 7;
const EVENT_DAY = { from: 7, until: 18 }; // local time, each day of the event
const DAY = 24 * 3600e3;

/** how far ahead of UTC the time is in tz at that moment, in ms (Intl does the timezone rules) */
function offsetAt(t, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(t)).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second) - Math.floor(t / 1000) * 1000;
}
/** the moment it's that local date and hour in tz (or at a fixed offset, in hours, when there's no timezone) */
function localTime(date, hour, tz, offsetHours = 0) {
  const [y, m, d] = date.split('-').map(Number), wall = Date.UTC(y, m - 1, d, hour);
  if (!tz) return wall - offsetHours * 3600e3;
  let t = wall;
  for (let i = 0; i < 2; i++) t = wall - offsetAt(t, tz); // twice, in case the guess crossed a clock change
  return t;
}
const validTz = (tz) => { try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true; } catch { return false; } };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

// a country's timezone, when Spartan doesn't give one: one zone for most; by longitude where there are several
const ONE_ZONE = { AD: 'Europe/Andorra', AE: 'Asia/Dubai', AR: 'America/Argentina/Buenos_Aires', AT: 'Europe/Vienna', BE: 'Europe/Brussels', BG: 'Europe/Sofia', CH: 'Europe/Zurich', CN: 'Asia/Shanghai', CR: 'America/Costa_Rica', CY: 'Asia/Nicosia', CZ: 'Europe/Prague', DE: 'Europe/Berlin', DK: 'Europe/Copenhagen', EE: 'Europe/Tallinn', ES: 'Europe/Madrid', FI: 'Europe/Helsinki', FR: 'Europe/Paris', GB: 'Europe/London', GR: 'Europe/Athens', HK: 'Asia/Hong_Kong', HR: 'Europe/Zagreb', HU: 'Europe/Budapest', IE: 'Europe/Dublin', IL: 'Asia/Jerusalem', IN: 'Asia/Kolkata', IS: 'Atlantic/Reykjavik', IT: 'Europe/Rome', JP: 'Asia/Tokyo', KR: 'Asia/Seoul', LT: 'Europe/Vilnius', LU: 'Europe/Luxembourg', LV: 'Europe/Riga', MT: 'Europe/Malta', MY: 'Asia/Kuala_Lumpur', NL: 'Europe/Amsterdam', NO: 'Europe/Oslo', NZ: 'Pacific/Auckland', PA: 'America/Panama', PH: 'Asia/Manila', PL: 'Europe/Warsaw', PT: 'Europe/Lisbon', QA: 'Asia/Qatar', RO: 'Europe/Bucharest', RS: 'Europe/Belgrade', SA: 'Asia/Riyadh', SE: 'Europe/Stockholm', SG: 'Asia/Singapore', SI: 'Europe/Ljubljana', SK: 'Europe/Bratislava', TH: 'Asia/Bangkok', TR: 'Europe/Istanbul', TW: 'Asia/Taipei', ZA: 'Africa/Johannesburg' };
const BY_LONGITUDE = { // [furthest west longitude, zone], east to west
  US: [[-87.5, 'America/New_York'], [-101, 'America/Chicago'], [-114.5, 'America/Denver'], [-150, 'America/Los_Angeles'], [-180, 'Pacific/Honolulu']],
  CA: [[-66, 'America/Halifax'], [-90, 'America/Toronto'], [-102, 'America/Winnipeg'], [-120, 'America/Edmonton'], [-180, 'America/Vancouver']],
  AU: [[141, 'Australia/Sydney'], [129, 'Australia/Adelaide'], [0, 'Australia/Perth']],
  MX: [[-106, 'America/Mexico_City'], [-114, 'America/Mazatlan'], [-180, 'America/Tijuana']],
  BR: [[-50, 'America/Sao_Paulo'], [-180, 'America/Manaus']],
};
function zoneOf(country, lon, lat) {
  if (country === 'ES' && lon < -12) return 'Atlantic/Canary'; // the Canary Islands, an hour behind Madrid
  if (country === 'PT' && lon < -12) return lon < -20 ? 'Atlantic/Azores' : 'Atlantic/Madeira';
  if (ONE_ZONE[country]) return ONE_ZONE[country];
  const bands = BY_LONGITUDE[country];
  if (!bands || !Number.isFinite(lon)) return '';
  if (country === 'AU' && lon >= 141 && Number.isFinite(lat) && lat > -29) return 'Australia/Brisbane'; // Queensland keeps no summer time
  return (bands.find(([west]) => lon >= west) || bands[bands.length - 1])[1];
}
let regionNames = null;
/** a country's two-letter code from its English name (events synced before the code was kept): '' if unknown */
let codes = null;
function codeOf(name) {
  if (!name) return '';
  if (/^[A-Z]{2}$/.test(name)) return name;
  if (!codes) { codes = new Map(); for (let a = 65; a < 91; a++) for (let b = 65; b < 91; b++) { const c = String.fromCharCode(a, b); const n = countryName(c); if (n && n !== c) codes.set(n.toLowerCase(), c); } }
  return codes.get(String(name).toLowerCase()) || '';
}
const countryName = (code) => { try { regionNames = regionNames || new Intl.DisplayNames(['en'], { type: 'region' }); return regionNames.of(code) || code; } catch { return code; } };

/** each day of the event, 07:00 to 18:00 local: [{ day, from, until }] */
function windows(ev) {
  const out = [];
  if (!isDate(ev?.startDate) || !isDate(ev?.endDate)) return out;
  for (let d = ev.startDate, i = 0; d <= ev.endDate && i < 14; d = addDays(d, 1), i++) {
    out.push({ day: d, from: localTime(d, EVENT_DAY.from, ev.tz, ev.offsetGuess), until: localTime(d, EVENT_DAY.until, ev.tz, ev.offsetGuess) });
  }
  return out;
}
/** the window a booking from..until fits in, or null */
const windowFor = (ev, from, until) => windows(ev).find((w) => from >= w.from && until <= w.until) || null;
/** the window a moment falls in, or null */
const windowAt = (ev, t) => windows(ev).find((w) => t >= w.from && t < w.until) || null;

const text = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
/** one of Spartan's races as kept here, or null when it's missing what booking needs. tz: its timezone from TIMES, if known. */
function normalise(r, t, tz = '') {
  if (!r || r.id === undefined || !isDate(r.start_date)) return null;
  const end = isDate(r.end_date) && r.end_date >= r.start_date ? r.end_date : r.start_date; // a one-day race often has no end date
  const subs = Array.isArray(r.subevents) ? r.subevents : [];
  const venue = r.venue || subs.find((s) => s?.venue)?.venue || {};
  const lon = Number(venue.longitude), lat = Number(venue.latitude);
  const code = /^[A-Z]{2}$/.test(venue.country || '') ? venue.country : '';
  const zone = [tz, subs.map((s) => s?.timezone).find(Boolean), zoneOf(code, lon, lat)].find((z) => z && validTz(z)) || '';
  const id = String(r.id).replace(/\D/g, '').slice(0, 12);
  return {
    id, name: text(r.name || r.event_name, 120), brand: text(r.brand, 40),
    city: text(venue.city, 60), country: text(code ? countryName(code) : venue.country, 60), countryCode: code || codeOf(venue.country), tz: zone, offsetGuess: zone || !Number.isFinite(lon) ? 0 : Math.round(lon / 15),
    startDate: r.start_date, endDate: end,
    url: `https://www.spartan.com/en/race/detail/${id}/overview`, syncedAt: t,
  };
}
const view = (ev) => ({ id: ev.id, name: ev.name, brand: ev.brand, city: ev.city, country: ev.country, countryCode: ev.countryCode || codeOf(ev.country), tz: ev.tz, startDate: ev.startDate, endDate: ev.endDate, url: ev.url, windows: windows(ev) });

function createEvents({ store, now = Date.now, reply, fetcher = (u) => fetch(u, { headers: { accept: 'application/json' } }) }) {
  let syncing = null;
  const getJson = async (u) => { const r = await fetcher(u); if (!r.ok) throw new Error(`Spartan's race list answered ${r.status}`); return r.json(); };
  // each race's timezone, from TIMES: best effort, as LIST has the races
  async function timezones() {
    const tz = new Map();
    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const j = await getJson(`${TIMES}?page=${page}`), list = Array.isArray(j?.upcoming_events) ? j.upcoming_events : [];
        if (!list.length) break;
        for (const r of list) { const z = (r.subevents || []).map((s) => s?.timezone).find((x) => x && validTz(x)); if (z) tz.set(String(r.id), z); }
      }
    } catch { /* the countries will do */ }
    return tz;
  }
  /** fetches every upcoming race and keeps them; the last good copy stays if anything goes wrong */
  async function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      const t = now();
      try {
        const races = [];
        for (let page = 1; page <= MAX_PAGES; page++) {
          const j = await getJson(page === 1 ? LIST : `${LIST}?page=${page}`), list = Array.isArray(j?.resources) ? j.resources : null;
          if (!list) throw new Error('Spartan\'s race list has changed shape');
          races.push(...list);
          const p = j.pagination?.table;
          if (!list.length || !p || races.length >= p.total || page >= p.total_pages) break;
        }
        const tz = await timezones(), got = new Map();
        for (const raw of races) { const ev = normalise(raw, t, tz.get(String(raw.id))); if (ev && ev.id) got.set(ev.id, ev); }
        if (!got.size) throw new Error('Spartan\'s race list came back empty');
        for (const ev of got.values()) await store.put('event', ev.id, ev);
        // events long over drop off (one no longer listed stays until then: a list has been seen to leave races out for a while)
        const today = new Date(t).toISOString().slice(0, 10);
        for (const old of await store.list('event')) if (!got.has(old.id) && old.endDate < addDays(today, -KEEP_DAYS_AFTER)) await store.remove('event', old.id);
        await store.put('settings', 'eventsync', { id: 'eventsync', at: t, ok: true, count: got.size, error: '' });
      } catch (e) {
        const was = (await store.get('settings', 'eventsync')) || {};
        await store.put('settings', 'eventsync', { ...was, id: 'eventsync', tried: t, ok: false, error: String(e.message || e).slice(0, 200) });
      } finally { syncing = null; }
    })();
    return syncing;
  }
  async function fresh() {
    const s = await store.get('settings', 'eventsync');
    if (!s?.at || now() - Math.max(s.at, s.tried || 0) > SYNC_HOURS * 3600e3) await sync();
  }
  /** events that haven't finished, soonest first */
  async function upcoming() {
    const t = now();
    return (await store.list('event')).map(view).filter((e) => e.windows.length && e.windows[e.windows.length - 1].until > t)
      .sort((a, b) => a.windows[0].from - b.windows[0].from);
  }
  async function listReply() {
    const s = (await store.get('settings', 'eventsync')) || {};
    return reply(200, { events: await upcoming(), syncedAt: s.at || 0, error: s.ok === false ? s.error : '' });
  }
  const get = async (id) => { const ev = await store.get('event', String(id || '')); return ev || null; };
  return {
    sync, fresh, upcoming, get,
    async events(method) { if (method !== 'GET') return reply(405, { error: 'Not allowed' }); await fresh(); return listReply(); },
    async adminSync(method) { if (method !== 'POST') return reply(405, { error: 'Not allowed' }); await sync(); return listReply(); },
  };
}

module.exports = { createEvents, windows, windowFor, windowAt, normalise, localTime, offsetAt, zoneOf, EVENT_DAY, LIST, TIMES };
