// "Sign in with Microsoft" (any work, school or personal Microsoft account), the only way to sign in to SpartanReferee's website.
// Microsoft's page opens in this tab and comes back to email-return.html with a one-time code, which the API swaps for a session.
import { call } from './api-base.js';
import { randomText, challengeFor, signInAddress, readReturn } from './email-signin-core.js';

const PENDING = 'hj_web_signin', TOKEN = 'sp_token';
const BACK_TO = new Set(['register.html', 'console.html', 'results.html', 'customers.html']);
const safeBack = (page) => (BACK_TO.has(page) ? page : './');

// Off to Microsoft's page, remembering (in this tab only) what's needed to finish when it comes back.
async function goSignIn(cfg, provider, back, options, onError) {
  try {
    const verifier = randomText(), state = randomText(16), redirectUri = cfg.webRedirectUri;
    sessionStorage.setItem(PENDING, JSON.stringify({ provider, verifier, state, redirectUri, back }));
    location.assign(signInAddress({ ...cfg, redirectUri }, { ...options, state, challenge: await challengeFor(verifier) }));
  } catch { onError(new Error('Sign-in couldn’t start here. Check this browser allows this site to store data, then try again.')); }
}

const MS_LOGO = '<svg viewBox="0 0 21 21" width="20" height="20" aria-hidden="true"><path fill="#f25022" d="M1 1h9v9H1z"/><path fill="#7fba00" d="M11 1h9v9h-9z"/><path fill="#00a4ef" d="M1 11h9v9H1z"/><path fill="#ffb900" d="M11 11h9v9h-9z"/></svg>';
/** Draws "Sign in with Microsoft" into el. Nothing shows if it isn't switched on. */
export async function microsoftButton(el, back, onError) {
  const { microsoftSignIn: cfg } = await call('config').catch(() => ({}));
  if (!cfg || !cfg.webRedirectUri) return;
  el.innerHTML = `<button class="msBtn" type="button">${MS_LOGO}<span>Sign in with Microsoft</span></button>`;
  el.firstChild.onclick = () => goSignIn(cfg, 'microsoft', back, { prompt: 'select_account' }, onError);
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
