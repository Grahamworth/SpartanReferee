// "Sign in with Microsoft" (any work, school or personal Microsoft account), the only way to sign in to SpartanReferee's website.
// Microsoft's page opens in this tab and comes back to email-return.html with a one-time code, which the API swaps for a session.
import { call, esc } from './api-base.js';
import { randomText, challengeFor, signInAddress, readReturn } from './email-signin-core.js';

const PENDING = 'hj_web_signin', TOKEN = 'sp_token';
const BACK_TO = new Set(['register.html', 'home.html', 'console.html', 'results.html', 'customers.html', 'learn/']);
// an event's page too, the join page with its invite, and a page of the app
const safeBack = (page) => (BACK_TO.has(page) || /^event\.html\?id=\d{1,12}$/.test(page) || /^join\.html\?t=[\w-]{20,64}$/.test(page) || /^learn\/#\/[\w/-]{0,80}$/.test(page) ? page : './');

// Off to Microsoft's page, remembering (in this tab only) what's needed to finish when it comes back.
async function goSignIn(cfg, provider, back, options, onError) {
  try {
    const verifier = randomText(), state = randomText(16), redirectUri = cfg.webRedirectUri;
    sessionStorage.setItem(PENDING, JSON.stringify({ provider, verifier, state, redirectUri, back }));
    location.assign(signInAddress({ ...cfg, redirectUri }, { ...options, state, challenge: await challengeFor(verifier) }));
  } catch { onError(new Error('Sign-in couldn’t start here. Check this browser allows this site to store data, then try again.')); }
}

const MS_LOGO = '<svg viewBox="0 0 21 21" width="20" height="20" aria-hidden="true"><path fill="#f25022" d="M1 1h9v9H1z"/><path fill="#7fba00" d="M11 1h9v9h-9z"/><path fill="#00a4ef" d="M1 11h9v9H1z"/><path fill="#ffb900" d="M11 11h9v9h-9z"/></svg>';
/** Draws the sign-in buttons into el: "Sign in with Microsoft", and "Sign in with Google" (Spartan's own accounts are Google's,
 *  from 19 November 2026) once the site has a Google client id (GOOGLE_CLIENT_ID). Each shows only if it's switched on. */
export async function microsoftButton(el, back, onError, opts = {}) {
  const cfg = await call('config').catch(() => ({}));
  const ms = cfg.microsoftSignIn && cfg.microsoftSignIn.webRedirectUri ? cfg.microsoftSignIn : null;
  const google = cfg.signIn && cfg.googleClientId && cfg.googleClientId !== 'dev' ? cfg.googleClientId : '';
  const code = !!cfg.codeSignIn;
  if (!ms && !google && !code) return;
  el.innerHTML = `<div class="signInBtns">${google ? '<div class="gBtn"></div>' : ''}${ms ? `<button class="msBtn" type="button">${MS_LOGO}<span>Sign in with Microsoft</span></button>` : ''}${code ? '<div class="codeBox"></div>' : ''}</div>`;
  // opts.email (the join page): the invited address, filled in on Microsoft's and Google's sign-in
  if (ms) el.querySelector('.msBtn').onclick = () => goSignIn(ms, 'microsoft', back, { prompt: 'select_account', ...(opts.email ? { loginHint: opts.email } : {}) }, onError);
  if (google) googleButton(el.querySelector('.gBtn'), google, back, onError, opts.email);
  if (code) codeSignIn(el.querySelector('.codeBox'), back, onError, opts);
}
const MAIL_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/></svg>';
/** "Sign in with email": for people with no Google or Microsoft account. They type their address, we email a 6-digit code
 *  (POST /api/auth/code), they type it (POST /api/auth/code/verify), and they're in. opts.email fixes the address (the join page). */
function codeSignIn(box, back, onError, opts = {}) {
  const draw = () => {
    box.innerHTML = `<button class="msBtn mailBtn" type="button">${MAIL_ICON}<span>Sign in with email</span></button>`;
    box.firstChild.onclick = () => askAddress();
  };
  const askAddress = () => {
    box.innerHTML = `<form class="codeForm"><label for="codeEmail">Your email address</label>
      <input id="codeEmail" type="email" autocomplete="email" required maxlength="254" value="${esc(opts.email || '')}"${opts.email ? ' readonly' : ''}>
      <button class="small primaryish" type="submit">Email me a code</button></form>`;
    const f = box.querySelector('form');
    if (!opts.email) f.codeEmail.focus();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const email = f.codeEmail.value.trim();
      f.querySelector('button').disabled = true;
      try { await call('auth/code', { method: 'POST', body: { email } }); askCode(email); }
      catch (err) { f.querySelector('button').disabled = false; onError(err); }
    };
  };
  const askCode = (email) => {
    box.innerHTML = `<form class="codeForm"><p class="note"></p>
      <label for="codeNum">The 6-digit code</label><input id="codeNum" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required>
      <button class="small primaryish" type="submit">Sign in</button> <button class="link" type="button" data-again>Send a new code</button></form>`;
    box.querySelector('.note').textContent = (window.SR_I18N ? SR_I18N.t('If {email} can sign in, a code is on its way to it. It works for 10 minutes.', { email }) : `If ${email} can sign in, a code is on its way to it. It works for 10 minutes.`);
    const f = box.querySelector('form');
    f.codeNum.focus();
    box.querySelector('[data-again]').onclick = () => askAddress();
    f.onsubmit = async (e) => {
      e.preventDefault();
      f.querySelector('button').disabled = true;
      try {
        const r = await call('auth/code/verify', { method: 'POST', body: { email, code: f.codeNum.value } });
        localStorage.setItem(TOKEN, r.token);
        location.assign(new URL(safeBack(back), `${location.origin}/`).href);
      } catch (err) { f.querySelector('button').disabled = false; onError(err); }
    };
  };
  draw();
}
/** Google's own button (Google Identity Services): it gives an id token, which the API checks (POST /api/auth/google) and swaps for a
 *  session; then on to the page to come back to, as after Microsoft's */
async function googleButton(box, clientId, back, onError, hint = '') {
  const loaded = await new Promise((res) => {
    if (window.google?.accounts?.id) { res(true); return; }
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s);
  });
  if (!loaded || !window.google?.accounts?.id) { box.remove(); return; } // offline, or blocked: Microsoft's button still works
  window.google.accounts.id.initialize({
    client_id: clientId, ux_mode: 'popup', ...(hint ? { login_hint: hint } : {}),
    callback: async (resp) => {
      try {
        const r = await call('auth/google', { method: 'POST', body: { idToken: resp.credential } });
        localStorage.setItem(TOKEN, r.token);
        location.assign(new URL(safeBack(back), `${location.origin}/`).href);
      } catch (e) { onError(e); }
    },
  });
  window.google.accounts.id.renderButton(box, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: Math.min(320, box.clientWidth || 320), locale: (window.SR_I18N && SR_I18N.lang) || 'en' });
}

/** On email-return.html: finish the sign-in. Says where to go next, and what went wrong if it did. */
export async function finishEmailSignIn(link = location.href) {
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem(PENDING)); sessionStorage.removeItem(PENDING); } catch { /* none */ }
  const back = safeBack(pending && pending.back);
  const answer = readReturn(link, pending);
  if (!answer) return { back, message: 'That sign-in has already been used, or was started in another window. Please try again.' };
  if (!answer.code) return { back, message: answer.message };
  try {
    const r = await call(pending.provider === 'microsoft' ? 'auth/microsoft' : 'auth/email', { method: 'POST', body: { code: answer.code, verifier: pending.verifier, redirectUri: pending.redirectUri } });
    localStorage.setItem(TOKEN, r.token);
    return { back, done: true };
  } catch (e) { return { back, message: e.message || 'Sign-in didn’t work. Please try again.' }; }
}
