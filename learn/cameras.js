// The cameras guide (step 1's addition): setting up and using the referee cameras, from the site's camera guides (streaming.html,
// phone.html) and the judge's advice on placing them. It ends with the only place a 30-minute practice camera is booked
// (/api/learn/practice-camera).
import { $, S, call, esc, toast, fail } from './core.js';

const CAMERA_GUIDE = `
  <section class="card guide"><h1>Cameras: setup and use</h1>
    <p>SpartanReferee films the penalty stations on phones and runs an AI judge on every camera, so each rep is counted and checked against the rules. Phones send their pictures to a SpartanReferee server over Wi-Fi or mobile data; the server records them, judges them and shows everything in a browser.</p>
    <nav class="toc" aria-label="In this guide"><a href="#g-before">Before the event</a><a href="#g-kit">What you need</a><a href="#g-place">Placing a camera</a><a href="#g-connect">Connecting a phone</a><a href="#g-judge">Judging</a><a href="#g-wrong">If something goes wrong</a><a href="#g-practice">Practise</a></nav>
  </section>
  <section class="card guide" id="g-before"><h2>1. Before the event</h2><ul>
    <li>Your events are on your home page. Open one to see its camera hours and who's refereeing it. The event's <b>head referee</b> books the burpee camera station (<b>Book the burpee cameras</b>); each event has one booking, and every referee can watch it live and review the results.</li>
    <li>An event's cameras run from 07:00 to 18:00 local time on each of its days.</li>
    <li>Each server takes 2 cameras. A booking made ahead starts its servers 10 minutes early, so the cameras are ready on time; starting now takes about 5 minutes.</li>
    <li>Check the venue's connection before the day: each camera sends about 3.5 Mbit/s, and the venue has to carry them all.</li></ul></section>
  <section class="card guide" id="g-kit"><h2>2. What you need</h2><ul>
    <li>A phone for each camera, on a tripod or stand, with a power bank and mobile data or Wi-Fi.</li>
    <li>Android phones use the <b>SpartanReferee Broadcaster</b> app; iPhones use <b>Larix Broadcaster</b> from the App Store.</li>
    <li>Any phone, tablet or computer with a browser, to watch the cameras and judge. Nothing to install on it.</li></ul></section>
  <section class="card guide" id="g-place"><h2>3. Placing a camera</h2><ul>
    <li>Phone in landscape, on its stand, 3 to 4 metres from the athletes.</li>
    <li>Keep each athlete's whole body in the picture, including when they lie flat.</li>
    <li>A slightly angled or side-on view judges chest to ground better than straight on. Push-ups and sit-ups need the phone side-on at floor level.</li>
    <li>Officials in hi-vis yellow tops are never counted as athletes, but keep the lanes clear of anyone else standing in front of the camera.</li></ul></section>
  <section class="card guide" id="g-connect"><h2>4. Connecting a phone</h2>
    <p>Once the booking is on, open it on the console: each camera waiting for its phone shows QR codes on the <b>Live</b> and <b>Cameras</b> tabs. The codes change with every booking, so scan them again each time.</p>
    <h3>Android: SpartanReferee Broadcaster</h3><ol>
      <li>Install the app. The phone warns you, as it isn't from the Play Store: tap Settings, turn on Allow from this source, go back and tap Install.</li>
      <li>Tap <b>Scan the camera's QR code</b> and scan that camera's code.</li>
      <li>Leave the quality on 720p unless the signal is weak, tap <b>Open the camera</b> and <b>GO LIVE</b>.</li></ol>
    <h3>iPhone: Larix Broadcaster</h3><ol>
      <li>Install Larix Broadcaster and open it once, allowing the camera and microphone.</li>
      <li>Scan the camera's iPhone (Larix) code with the phone's camera, open the link in Larix and tap Import.</li>
      <li>In Larix, go to Settings, then Connections, tick the camera, and press the red button.</li></ol>
    <p class="note">The full guides: <a href="../streaming.html">setting up the cameras</a> and <a href="../phone.html">one camera phone</a>.</p></section>
  <section class="card guide" id="g-judge"><h2>5. Judging</h2><ul>
    <li>On the <b>Live</b> tab each phone's picture shows within a few seconds of going live.</li>
    <li>Press <b>Start AI judge</b> on a camera, give it a name and choose what it's judging (burpees, squats, push-ups and more), then <b>Start judging</b>.</li>
    <li>Do a few test reps in front of each camera and check they're counted. The judge runs on the server, so it carries on when you close the page.</li>
    <li><b>Results</b> lists everyone judged. <b>Watch</b> plays an athlete with every rep and no rep; <b>Find athlete number</b> searches every camera. Recordings and results are kept for 7 days.</li></ul></section>
  <section class="card guide" id="g-wrong"><h2>6. If something goes wrong</h2><ul>
    <li><b>A phone won't connect:</b> check its signal, and scan its code again from this booking.</li>
    <li><b>The picture stutters or drops:</b> the signal is too weak for 720p. Pick a lower quality.</li>
    <li><b>A camera shows but no picture:</b> the venue's network may block video. Try the browser on a phone's mobile data.</li>
    <li><b>The server didn't start:</b> the console says why. Sometimes Azure has no servers free for a few minutes: try again.</li>
    <li><b>The venue's internet fails:</b> nothing reaches the server until it's back. Only Larix keeps its own copy on the phone.</li></ul></section>
  <section class="card guide" id="g-practice"><h2>7. Practise</h2>
    <p>Try it all before an event with a practice camera: 30 minutes on a real server, at any time, just for you. Point a phone at yourself doing a few burpees and see them judged. It can't be extended: book another when it ends.</p>
    <div id="practice"><p class="muted">Checking for a practice camera…</p></div></section>`;

export const views = { async cameras() { return CAMERA_GUIDE; } };

// the practice camera: whether one's on, or a way to start one (not while viewing as someone else: it'd be yours)
async function drawPractice() {
  const box = $('practice'); if (!box) return;
  if (S.me.actingAs) { box.innerHTML = '<p class="note">Practice cameras are booked as yourself: switch View as back to yourself.</p>'; return; }
  let r; try { r = await call('practice-camera'); } catch (e) { box.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  const s = r.server || {}, open = `../console.html?unit=${encodeURIComponent(r.unit)}`, clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (s.wanted === 'on') {
    box.innerHTML = `<p class="practiceState"><b>${s.state === 'on' ? `Your practice camera is on until ${esc(clock(s.until))}.` : 'Your practice camera is starting: about 5 minutes.'}</b></p>
      <p>Open it on the console to scan its code with a phone, start the AI judge and watch.</p><a class="practiceBtn" href="${open}">Open my practice camera</a>`;
    return;
  }
  box.innerHTML = `<form id="practiceForm" class="practiceForm"><label for="pc-cams">Cameras</label>
    <select id="pc-cams" name="cameras"><option value="1">1 camera</option><option value="2">2 cameras</option></select>
    <button class="practiceBtn" type="submit">Start a 30-minute practice camera</button></form><p class="note">It starts now and takes about 5 minutes to be ready.</p>`;
  $('practiceForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = e.target.querySelector('button'); btn.disabled = true;
    try { await call('practice-camera', { method: 'POST', body: { cameras: Number($('pc-cams').value) } }); toast('Practice camera starting'); drawPractice(); }
    catch (err) { fail(err.message); btn.disabled = false; }
  });
}
export function wire() {
  drawPractice();
  // the guide's own contents links scroll within it, without changing the page's view
  for (const a of document.querySelectorAll('.toc a')) a.onclick = (e) => { e.preventDefault(); document.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
}
