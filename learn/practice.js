// The practice cameras, shown on the last lesson of the Burpee camera station course (slides with an "action"): the free camera for
// everyone, and the only place a 30-minute practice server is booked (/api/learn/practice-camera), for head referees and admins.
import { $, S, call, esc, toast, fail } from './core.js';

const FREE = `<p><a class="practiceBtn" href="../review-free/">Open the free camera</a></p>`;

/** fills a slide's action box */
export function drawAction(box, action) {
  if (!box) return;
  if (action === 'free-camera') { box.innerHTML = FREE; return; }
  if (action === 'practice-camera') { box.innerHTML = '<div id="practice"><p class="muted">Checking for a practice camera…</p></div>'; drawPractice(); }
}

// whether one's on, or a way to start one (not while viewing as someone else: it'd be yours)
async function drawPractice() {
  const box = $('practice'); if (!box) return;
  if (S.me.actingAs) { box.innerHTML = '<p class="note">Practice cameras are booked as yourself: switch Preview as back to yourself.</p>'; return; }
  let r; try { r = await call('practice-camera'); } catch (e) { box.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  // a practice server is for head referees and admins (it uses one of the servers events need); everyone else has the free camera
  if (!r.canPractise && r.server?.wanted !== 'on') { box.innerHTML = `<p class="note">You can practise any time with the free camera. Practice servers are for head referees and admins.</p>${FREE}`; return; }
  const s = r.server || {}, open = `../console.html?unit=${encodeURIComponent(r.unit)}`, clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (s.wanted === 'on') {
    box.innerHTML = `<p class="practiceState"><b>${s.state === 'on' ? `Your practice camera is on until ${esc(clock(s.until))}.` : 'Your practice camera is starting: about 5 minutes.'}</b></p>
      <p>Open it on the console to scan its code with a phone, start the AI judge and watch.</p><a class="practiceBtn" href="${open}">Open my practice camera</a>`;
    return;
  }
  box.innerHTML = `<form id="practiceForm" class="practiceForm"><label for="pc-cams">Cameras</label>
    <select id="pc-cams" name="cameras"><option value="1">1 camera</option><option value="2">2 cameras</option></select>
    <button class="practiceBtn" type="submit">Start a 30-minute practice server</button></form><p class="note">A real server, as at an event: it starts now, takes about 5 minutes to be ready, and can't be extended.</p>`;
  $('practiceForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = e.target.querySelector('button'); btn.disabled = true;
    try { await call('practice-camera', { method: 'POST', body: { cameras: Number($('pc-cams').value) } }); toast('Practice camera starting'); drawPractice(); }
    catch (err) { fail(err.message); btn.disabled = false; }
  });
}
