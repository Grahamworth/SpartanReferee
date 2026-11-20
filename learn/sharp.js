// Keeping sharp: the quick check at the end of a lesson, refreshers (#/refresh), the weekly streak and badges (#/badges), the Keep
// sharp bar at the top of Learning and each programme's page. The server side is api/src/learn/checks.js. It's practice: the answers come with the questions,
// so the page marks them itself, and with no signal the answers wait in the outbox (core.js) like lesson progress.
import { $, call, esc, t, toast, hooks, day, redraw } from './core.js';

// ---------------------------------------------------------------- badges
const BADGE = {
  started: ['First lesson', 'Finished your first lesson'],
  halfway: ['Halfway', 'Half the lessons done'],
  lessons: ['All lessons done', 'Every lesson in the programme done'],
  sharp: ['Sharp eye', 'Every quick check answered right'],
  qualified: ['Qualified', 'Passed the assessment'],
  'streak-4': ['Four weeks running', 'Learned something four weeks in a row'],
  'streak-12': ['Twelve weeks running', 'Learned something twelve weeks in a row'],
  'refresher-5': ['Five refreshers', 'Did five refreshers'],
};
const GLYPH = {
  started: '<path d="M9 12.5l2 2 4-4.5"/>',
  halfway: '<path d="M12 7v10"/><path d="M12 7a5 5 0 010 10"/>',
  lessons: '<path d="M8 9h8M8 12h8M8 15h5"/>',
  sharp: '<circle cx="12" cy="12" r="2.2"/><circle cx="12" cy="12" r="5"/>',
  qualified: '<path d="M12 7.5l1.4 2.9 3.1.4-2.3 2.2.6 3.1-2.8-1.5-2.8 1.5.6-3.1-2.3-2.2 3.1-.4z"/>',
  'streak-4': '<path d="M12 6.5c1.8 2.2 3.5 3.9 3.5 6.3a3.5 3.5 0 01-7 0c0-1.3.6-2.3 1.5-3.2.2 1.2.8 1.8 1.5 2 0-2 .2-3.6.5-5.1z"/>',
  'streak-12': '<path d="M12 6.5c1.8 2.2 3.5 3.9 3.5 6.3a3.5 3.5 0 01-7 0c0-1.3.6-2.3 1.5-3.2.2 1.2.8 1.8 1.5 2 0-2 .2-3.6.5-5.1z"/>',
  'refresher-5': '<path d="M16.5 9.5A5 5 0 107 13"/><path d="M16.8 6.5v3.2h-3.2"/>',
};
export const badgeName = (b) => t(BADGE[b.kind]?.[0] || b.kind);
export function badgeIcon(b, size = 'md') {
  const [name, what] = BADGE[b.kind] || [b.kind, ''];
  const label = `${t(name)}${b.programmeTitle ? ` · ${b.programmeTitle}` : ''}: ${b.earned ? t('earned {date}', { date: day(b.earnedAt) }) : t('not yet')}`;
  return `<span class="badgeIcon ${size}${b.earned ? ' on' : ''}" title="${esc(`${label}. ${t(what)}`)}" role="img" aria-label="${esc(label)}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" class="ring"/>${GLYPH[b.kind] || ''}</svg></span>`;
}
/** a toast for badges just earned */
export function celebrate(badges) {
  if (!badges?.length) return;
  setTimeout(() => toast(badges.length === 1 ? t('New badge: {name}', { name: badgeName(badges[0]) }) : t('{n} new badges: {names}', { n: badges.length, names: badges.map(badgeName).join(', ') })), 900);
}

// ---------------------------------------------------------------- the quiz: one question at a time, marked at once
const WHY = { rule: 'The rule changed', missed: 'Missed last time', due: 'Due for a refresh', extra: 'Extra practice' };
/** a question in the page's language: the words a translator wrote in Programs (k.tr), where there are some (authoring.js) */
export const localQ = (k) => {
  const tr = k.tr?.[(window.SR_I18N && SR_I18N.lang) || 'en'];
  return tr ? { ...k, prompt: tr.prompt || k.prompt, options: k.options.map((o, i) => tr.options?.[i] || o), feedback: tr.feedback || k.feedback } : k;
};
/** draws questions into box; onDone(answers: [{key, choice, right}]) once the last is answered */
export function quiz(box, questions, onDone, { showLesson = false } = {}) {
  questions = questions.map(localQ);
  const answers = [];
  const draw = (i) => {
    const k = questions[i];
    box.innerHTML = `<div class="quiz">
      <p class="quizCount"><span>${esc(t('Question {n} of {total}', { n: i + 1, total: questions.length }))}</span>${k.why ? ` <span class="quizWhy w-${esc(k.why)}">${esc(t(WHY[k.why]))}</span>` : ''}</p>
      <fieldset><legend class="quizQ">${esc(k.prompt)}</legend>
        ${k.options.map((o, j) => `<label class="quizOpt"><input type="radio" name="quizOpt" value="${j}"><span>${esc(o)}</span></label>`).join('')}
      </fieldset>
      ${showLesson && k.lessonTitle ? `<p class="note">From <a href="#/lesson/${esc(k.lessonId)}">${esc(k.lessonTitle)}</a></p>` : ''}
      <div class="quizFeedback" role="status" aria-live="polite" hidden></div>
      <div class="btnRow"><button class="primary" type="button" data-quiz-check disabled>Check</button><button class="primary" type="button" data-quiz-next hidden>${i + 1 < questions.length ? 'Next question' : 'See how you did'}</button></div>
    </div>`;
    const check = box.querySelector('[data-quiz-check]'), next = box.querySelector('[data-quiz-next]');
    box.querySelectorAll('input[name=quizOpt]').forEach((r) => { r.onchange = () => { check.disabled = false; }; });
    check.onclick = () => {
      const picked = box.querySelector('input[name=quizOpt]:checked'); if (!picked) return;
      const choice = Number(picked.value), right = choice === k.answer;
      answers.push({ key: k.key, choice, right });
      box.querySelectorAll('.quizOpt').forEach((l, j) => { l.classList.toggle('right', j === k.answer); l.classList.toggle('wrong', j === choice && !right); l.querySelector('input').disabled = true; });
      const fb = box.querySelector('.quizFeedback');
      fb.className = `quizFeedback ${right ? 'isRight' : 'isWrong'}`;
      fb.innerHTML = `<p><b>${right ? '✓ Right' : '✗ Not quite'}</b>${right ? '' : ` <span>${esc(t('The answer is: {answer}', { answer: t(k.options[k.answer]) }))}</span>`}</p>
        ${k.feedback ? `<p>${esc(k.feedback)}</p>` : ''}${k.rules?.length ? `<p class="ruleChips">${k.rules.map((r) => `<a class="chipLink" href="#/rules/${encodeURIComponent(r)}">${esc(r.replace(/^OCR-\d{4}-/, ''))}</a>`).join(' ')}</p>` : ''}`;
      fb.hidden = false; check.hidden = true; next.hidden = false; next.focus();
    };
    next.onclick = () => (i + 1 < questions.length ? draw(i + 1) : onDone(answers));
    box.querySelector('.quizQ').focus?.();
  };
  draw(0);
}
const score = (answers) => t('{right} of {total} right', { right: answers.filter((a) => a.right).length, total: answers.length });

// ---------------------------------------------------------------- the test at the end of a lesson (lesson.js)
// "Finish and test" (20 November 2026): the lesson's slides are put away and its questions asked. Every try is kept (the assessors see
// them); with any answer wrong, the test can be taken again or the lesson redone. Taking it completes the lesson (enrolled), as before.
/** the test's place in the lesson's finish card */
export function checkSection(L) {
  const checks = L.extra?.checks || [];
  if (!checks.length) return '';
  const tests = L.extra.tests || { attempts: 0, passed: false };
  return `<div class="quickCheck" id="lpCheck">
      <h3>${esc(t('Test'))}</h3>
      <p class="note" id="lpTestNote">${esc(tests.attempts ? (tests.passed ? t('You\'ve had every answer right before. Tries so far: {n}.', { n: tests.attempts }) : t('Tries so far: {n}. Get every answer right to pass.', { n: tests.attempts }))
    : t('{n} questions on what you just learned. Get every answer right to pass; you can try again, or go through the lesson again first.', { n: checks.length }))}</p>
      <div id="lpQuiz"></div>
    </div>`;
}
/** the result after a test: the score, then each question with your answer and (if you missed it) the right one */
function resultHtml(questions, answers) {
  return `<div class="quizResult"><p class="quizScore">${esc(score(answers))}</p>
    <ol class="quizReview">${answers.map((a) => {
      const k = localQ(questions.find((q) => q.key === a.key) || {}); if (!k.key) return '';
      return `<li class="${a.right ? 'isRight' : 'isWrong'}"><span class="qMark" aria-hidden="true">${a.right ? '✓' : '✗'}</span><span><span class="q">${esc(k.prompt)}</span>
        <small>${esc(t('Your answer: {answer}', { answer: t(k.options[a.choice]) }))}${a.right ? '' : ` · <b>${esc(t('Right answer: {answer}', { answer: t(k.options[k.answer]) }))}</b>`}</small></span></li>`;
    }).join('')}</ol><p class="note" id="lpResultNote">${esc(t('Saving…'))}</p><div class="btnRow" id="lpRetry" hidden></div></div>`;
}
/** wires the test: returns start(), which asks the questions afresh; redo() is called for "Go through the lesson again" */
export function wireCheck(L, { redo } = {}) {
  const sec = $('lpCheck'); if (!sec) return null;
  let completed = L.completions.some((x) => !x.preview);
  const start = () => {
    const box = $('lpQuiz'); if (!box) return;
    quiz(box, L.extra.checks, async (answers) => {
      box.innerHTML = resultHtml(L.extra.checks, answers);
      const note = $('lpResultNote'), retry = $('lpRetry'), lines = [];
      const all = answers.every((a) => a.right);
      let ok = true;
      try {
        const r = await call(`lessons/${L.lesson.id}/checks`, { method: 'POST', body: { answers: answers.map(({ key, choice }) => ({ key, choice })) } });
        celebrate(r.badges);
        const tests = L.extra.tests = { attempts: r.attemptNo || (L.extra.tests?.attempts || 0) + 1, passed: (L.extra.tests?.passed) || all };
        lines.push(all ? t('Every answer right: you\'ve passed this lesson\'s test.') : t('Not every answer was right. Take the test again, or go through the lesson again first.'));
        if (!r.queued) lines.push(t('Try {n} recorded.', { n: tests.attempts }));
        if (L.enrolled && !completed) {
          const c = await call(`lessons/${L.lesson.id}/complete`, { method: 'POST', body: { contentId: L.content.id } });
          completed = true;
          lines.push(c.queued ? t('Saved on this phone: it goes to your record when there\'s signal') : c.preview ? t('Recorded: done in a preview translation') : c.enrolment?.state === 'completed' ? t('Lesson complete: programme complete!') : t('Lesson complete'));
          celebrate(c.badges);
          const h = $('lpFinish')?.querySelector('h2'); if (h) h.textContent = t('You\'ve completed this lesson');
        } else if (r.queued) lines.push(t('Saved on this phone: it\'s sent when there\'s signal.'));
      } catch (e) { ok = false; lines.push(e.message); }
      note.innerHTML = lines.map((x) => `<span>${esc(x)}</span>`).join('<br>');
      if (!all || !ok) {
        retry.innerHTML = `<button class="primary" type="button" data-retest>${esc(t('Take the test again'))}</button>${redo ? `<button type="button" data-redo>${esc(t('Go through the lesson again'))}</button>` : ''}`;
        retry.hidden = false;
        retry.querySelector('[data-retest]').onclick = start;
        retry.querySelector('[data-redo]')?.addEventListener('click', redo);
      }
      const next = $('lpNextWrap');
      if (ok && next) { next.hidden = false; if (all) next.querySelector('a')?.focus(); }
    });
    sec.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  return start;
}

// ---------------------------------------------------------------- the weekly streak
export function streakStrip(s) {
  return `<div class="streak"><p class="streakNum"><b>${s.weeks}</b> <span>${esc(s.weeks === 1 ? t('week in a row') : t('weeks in a row'))}</span></p>
    <ol class="streakWeeks" aria-label="${esc(t('The last 8 weeks'))}">${s.recent.map((on, i) => `<li class="${on ? 'on' : ''}${i === 7 ? ' now' : ''}" title="${esc(i === 7 ? t('This week') : t('{n} weeks ago', { n: 7 - i }))}"></li>`).join('')}</ol>
    <p class="note">${esc(s.thisWeek ? (s.best > s.weeks ? t('This week counts. Best run: {best} weeks.', { best: s.best }) : t('This week counts.')) : s.weeks ? t('Do a lesson or a refresher this week to keep it going.') : t('A week counts when you do a lesson, a quick check or a refresher.'))}</p></div>`;
}

// ---------------------------------------------------------------- on the overview and each programme's page
let progressCache = null;
const progress = () => (progressCache = progressCache || call('progress').finally(() => setTimeout(() => { progressCache = null; }, 2000)));
// at the top of Learning (programmes.js, 20 November 2026): a small bar with a refresher question to answer there and then, and how close
// the nearest badges are. It shows once some lessons (and their quick checks) are done; before that there's nothing to practise.
let BAR = null;
hooks.learning.push(async () => {
  let p, r; try { [p, r] = await Promise.all([progress(), call('refresher?more=1')]); } catch { return ''; }
  if (!r.practised || !r.questions.length) return '';
  BAR = { questions: r.questions.map(localQ), at: 0, right: 0, badges: p.badges, streak: p.streak };
  return `<section class="sharpBar" id="sharpBar" aria-labelledby="sharpTitle"><div id="sharpBody"></div>${barFoot(BAR)}</section>`;
});
const near = (badges) => badges.filter((b) => !b.earned && b.need > 0 && b.kind !== 'qualified').sort((a, b) => b.have / b.need - a.have / a.need).slice(0, 2);
function barFoot(s) {
  return `<div class="sharpFoot"><span class="sharpStreak"><b>${s.streak.weeks}</b> ${esc(s.streak.weeks === 1 ? t('week in a row') : t('weeks in a row'))}</span>
    ${near(s.badges).map((b) => `<span class="sharpNear">${badgeIcon(b, 'sm')}<span><small>${esc(badgeName(b))}${b.programmeTitle ? ` · ${esc(b.programmeTitle)}` : ''}</small>
      <span class="sharpMeter" role="img" aria-label="${esc(t('{have} of {need}', { have: b.have, need: b.need }))}"><i style="width:${Math.round((100 * b.have) / b.need)}%"></i></span><small>${esc(t('{have} of {need}', { have: b.have, need: b.need }))}</small></span></span>`).join('')}
    <a class="sharpAll" href="#/badges">${esc(t('All badges'))}</a></div>`;
}
function drawBar() {
  const box = $('sharpBody'), s = BAR; if (!box || !s) return;
  if (s.at >= s.questions.length) {
    box.innerHTML = `<p class="sharpHead"><b id="sharpTitle">${esc(t('Keep sharp'))}</b> <span>${esc(t('{right} of {total} right', { right: s.right, total: s.questions.length }))}</span></p>
      <div class="btnRow"><button class="small" type="button" id="sharpMore">${esc(t('More questions'))}</button></div>`;
    $('sharpMore').onclick = () => redraw();
    return;
  }
  const k = s.questions[s.at];
  box.innerHTML = `<p class="sharpHead"><b id="sharpTitle">${esc(t('Keep sharp'))}</b>${k.why ? ` <span class="quizWhy w-${esc(k.why)}">${esc(t(WHY[k.why]))}</span>` : ''} <span class="sharpCount">${esc(t('Question {n} of {total}', { n: s.at + 1, total: s.questions.length }))}</span></p>
    <p class="sharpQ">${esc(k.prompt)}</p>
    <div class="sharpOpts">${k.options.map((o, j) => `<button type="button" class="sharpOpt" data-opt="${j}">${esc(o)}</button>`).join('')}</div>
    <div class="sharpFb" role="status" aria-live="polite" hidden></div>`;
  for (const b of box.querySelectorAll('[data-opt]')) b.onclick = async () => {
    const choice = Number(b.dataset.opt), right = choice === k.answer, last = s.at === s.questions.length - 1;
    if (right) s.right++;
    box.querySelectorAll('.sharpOpt').forEach((x, j) => { x.disabled = true; x.classList.toggle('right', j === k.answer); x.classList.toggle('wrong', j === choice && !right); });
    const fb = box.querySelector('.sharpFb');
    fb.className = `sharpFb ${right ? 'isRight' : 'isWrong'}`;
    fb.innerHTML = `<p><b>${right ? `✓ ${esc(t('Right'))}` : `✗ ${esc(t('Not quite'))}`}</b>${right ? '' : ` <span>${esc(t('The answer is: {answer}', { answer: k.options[k.answer] }))}</span>`}${k.feedback ? ` <span>${esc(k.feedback)}</span>` : ''}</p>
      <div class="btnRow"><button class="small primaryish" type="button" id="sharpNext">${esc(last ? t('Finish') : t('Next question'))}</button>${k.lessonTitle ? `<a class="small" href="#/lesson/${esc(k.lessonId)}">${esc(t('From {lesson}', { lesson: k.lessonTitle }))}</a>` : ''}</div>`;
    fb.hidden = false;
    $('sharpNext').onclick = () => { s.at++; drawBar(); };
    try {
      const r = await call('refresher', { method: 'POST', body: { answers: [{ key: k.key, choice }], partial: !last } });
      celebrate(r.badges);
      if (last && !r.queued) { progressCache = null; const p = await progress(); s.badges = p.badges; s.streak = p.streak; $('sharpBar')?.querySelector('.sharpFoot')?.replaceWith(Object.assign(document.createElement('div'), { innerHTML: barFoot(s) }).firstElementChild); }
    } catch (e) { toast(e.message); }
  };
}
hooks.programme.push(async (d) => {
  if (d.slot !== 'progress' || !d.enrolment) return '';
  let p; try { p = await progress(); } catch { return ''; }
  const mine = p.badges.filter((b) => b.programmeId === d.programme.id), r = p.refresher.find((x) => x.programmeId === d.programme.id);
  return `<div class="progSharp"><h3>Badges</h3><div class="badgeRow">${mine.map((b) => badgeIcon(b, 'sm')).join('')}</div>
    ${r?.practised ? `<p class="note">${esc(r.due ? t('{n} refresher questions are due.', { n: r.due }) : t('No refresher questions are due right now.'))} <a href="#/refresh?programme=${esc(d.programme.id)}${r.due ? '' : '&more=1'}">${r.due ? 'Start a refresher' : 'Practise anyway'}</a></p>` : ''}</div>`;
});

// ---------------------------------------------------------------- the refresher (#/refresh) and all badges (#/badges)
async function refreshView() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const pid = q.get('programme') || '';
  const r = await call(`refresher?${new URLSearchParams([...(pid ? [['programme', pid]] : []), ...(q.get('more') ? [['more', '1']] : [])])}`);
  const head = `<section class="card"><p class="crumbs"><a href="#/">Overview</a></p><h1>Refresher</h1>
    <p class="note">Questions from lessons you've done come back after 1, 3, 7, 21, 60 and then 120 days, sooner if you missed them, and straight away if a rule they're about changes.</p>`;
  if (!r.practised) return `${head}<p>${esc(t('Nothing to refresh yet. Finish a lesson and its quick check first.'))}</p><a class="btnLink" href="#/programmes">Programmes</a></section>`;
  if (!r.questions.length) return `${head}<p>${esc(r.nextDue ? t('Nothing is due. The next question is due {date}.', { date: day(r.nextDue) }) : t('Nothing is due.'))}</p><a class="btnLink" href="#/refresh?${pid ? `programme=${esc(pid)}&` : ''}more=1">Practise anyway</a></section>`;
  REFRESH = r.questions;
  return `${head}</section><section class="card" id="refreshBox"></section>`;
}
let REFRESH = null;
async function badgesView() {
  const p = await progress();
  const groups = new Map();
  for (const b of p.badges) { const g = b.programmeTitle || t('Overall'); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(b); }
  return `<section class="card"><p class="crumbs"><a href="#/">Overview</a></p><h1>Badges</h1>
      <p class="note">Badges mark your progress. They're yours to keep, and there's no leaderboard: refereeing isn't a race.</p>${streakStrip(p.streak)}</section>
    ${[...groups].map(([g, list]) => `<section class="card"><h2>${esc(g)}</h2><ul class="badgeList">${list.map((b) => `<li class="${b.earned ? 'on' : ''}">${badgeIcon(b)}<span><b>${esc(badgeName(b))}</b><small>${esc(t(BADGE[b.kind]?.[1] || ''))}</small><small>${esc(b.earned ? t('earned {date}', { date: day(b.earnedAt) }) : t('not yet'))}</small></span></li>`).join('')}</ul></section>`).join('')}`;
}
export const views = { refresh: refreshView, badges: badgesView };
export function wire() {
  const bar = $('sharpBar');
  if (bar && BAR && !bar.dataset.wired) { bar.dataset.wired = '1'; drawBar(); }
  const box = $('refreshBox');
  if (box && REFRESH) {
    const questions = REFRESH; REFRESH = null;
    quiz(box, questions, async (answers) => {
      box.innerHTML = `<h2>${esc(score(answers))}</h2><p class="note">${esc(t('Saving…'))}</p>`;
      try {
        const r = await call('refresher', { method: 'POST', body: { answers: answers.map(({ key, choice }) => ({ key, choice })) } });
        box.innerHTML = `<h2>${esc(score(answers))}</h2>
          <p>${esc(r.queued ? t('Saved on this phone: it\'s sent when there\'s signal.') : r.due ? t('{n} more are due.', { n: r.due }) : r.nextDue ? t('All done. The next question is due {date}.', { date: day(r.nextDue) }) : t('All done.'))}</p>
          ${r.streak ? streakStrip(r.streak) : ''}
          <div class="btnRow">${r.due ? '<a class="btnLink primaryLink" href="#/refresh">Keep going</a>' : ''}<a class="btnLink" href="#/">Back to the overview</a></div>`;
        celebrate(r.badges);
      } catch (e) { box.querySelector('.note').textContent = e.message; }
    }, { showLesson: true });
  }
}
