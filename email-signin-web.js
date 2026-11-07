// Email sign-in on the website: the same accounts as the Broadcaster app, and the same emailed code at each sign-in. Microsoft's
// page opens in this tab and comes back to email-return.html with a one-time code, which the API swaps for a session.
import { call } from './api-base.js';
import { randomText, challengeFor, signInAddress, readReturn } from './email-signin-core.js';

const PENDING = 'hj_web_signin', TOKEN = 'sp_token';
const BACK_TO = new Set(['register.html', 'console.html']);
const safeBack = (page) => (BACK_TO.has(page) ? page : './');

/** Draws the two email buttons into el. `back` is the page to come back to. Nothing shows if email sign-in isn't switched on. */
export async function emailButtons(el, back, onError) {
  const { emailSignIn: cfg } = await call('config').catch(() => ({}));
  if (!cfg || !cfg.webRedirectUri) return;
  el.innerHTML = `<p class="orLine"><span>or</span></p>
    <button class="primary emailBtn" type="button" data-create="">Sign in with email</button>
    <button class="link emailCreate" type="button" data-create="1">Create an account with email</button>
    <p class="note">After your password, we’ll email you a code to confirm it’s you.</p>`;
  for (const button of el.querySelectorAll('button')) {
    button.onclick = async () => {
      try {
        const verifier = randomText(), state = randomText(16), redirectUri = cfg.webRedirectUri;
        sessionStorage.setItem(PENDING, JSON.stringify({ verifier, state, redirectUri, back }));
        location.assign(signInAddress({ ...cfg, redirectUri }, { create: !!button.dataset.create, state, challenge: await challengeFor(verifier) }));
      } catch { onError(new Error('Sign-in couldn’t start here. Check this browser allows this site to store data, then try again.')); }
    };
  }
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
    const r = await call('auth/email', { method: 'POST', body: { code: answer.code, verifier: pending.verifier, redirectUri: pending.redirectUri } });
    localStorage.setItem(TOKEN, r.token);
    return { back, done: true };
  } catch (e) { return { back, message: e.message || 'Sign-in didn’t work. Please try again.' }; }
}
