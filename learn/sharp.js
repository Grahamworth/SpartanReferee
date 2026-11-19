// Keeping sharp: the quick check at the end of a lesson, refreshers (#/refresh), the weekly streak and badges (#/badges), on the
// overview and each programme's page. The server side is api/src/learn/checks.js. It's practice: the answers come with the questions,
// so the page marks them itself, and with no signal the answers wait in the outbox (core.js) like lesson progress.
import { $, call, esc, t, toast, hooks, day } from './core.js';

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
/** draws questions into box; onDone(answers: [{key, choice, right}]) once the last is answered */
export function quiz(box, questions, onDone, { showLesson = false } = {}) {
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

// ---------------------------------------------------------------- the quick check at the end of a lesson (lesson.js)
/** the check's section for the lesson's finish card: before it's answered, "Mark as complete" (#lpComplete) waits */
export function checkSection(L) {
  const checks = L.extra?.checks || [];
  if (!checks.length) return '';
  const st = L.extra.checkState || {}, answered = checks.every((k) => st[k.key]);
  const right = checks.filter((k) => st[k.key]?.right).length;
  return `<div class="quickCheck" id="lpCheck" data-answered="${answered ? 1 : 0}">
      <h3>Quick check</h3>
      ${answered ? `<p class="note">${esc(t('Last time: {right} of {total} right.', { right, total: checks.length }))} <button class="small" type="button" data-check-again>Try it again</button></p>`
    : `<p class="note">${esc(t('{n} questions on what you just learned. They don\'t count towards anything: they help it stick, and they come back as refreshers.', { n: checks.length }))}</p><div id="lpQuiz"></div>`}
    </div>`;
}
/** the result after a lesson's quick check: the score, then each question with your answer and (if you missed it) the right one */
function resultHtml(questions, answers) {
  return `<div class="quizResult"><p class="quizScore">${esc(score(answers))}</p>
    <ol class="quizReview">${answers.map((a) => {
      const k = questions.find((q) => q.key === a.key); if (!k) return '';
      return `<li class="${a.right ? 'isRight' : 'isWrong'}"><span class="qMark" aria-hidden="true">${a.right ? '✓' : '✗'}</span><span><span class="q">${esc(k.prompt)}</span>
        <small>${esc(t('Your answer: {answer}', { answer: t(k.options[a.choice]) }))}${a.right ? '' : ` · <b>${esc(t('Right answer: {answer}', { answer: t(k.options[k.answer]) }))}</b>`}</small></span></li>`;
    }).join('')}</ol><p class="note" id="lpResultNote">${esc(t('Saving…'))}</p></div>`;
}
/** the quick check at the end of a lesson: once it's answered (right or wrong) the lesson is completed (enrolled), the result shows,
 *  and only then does the way to the next lesson (#lpNextWrap) appear */
export function wireCheck(L) {
  const sec = $('lpCheck'); if (!sec) return;
  const done = L.completions.some((x) => !x.preview);
  const run = (box) => quiz(box, L.extra.checks, async (answers) => {
    box.innerHTML = resultHtml(L.extra.checks, answers);
    const note = $('lpResultNote'), lines = [];
    let ok = true;
    try {
      const r = await call(`lessons/${L.lesson.id}/checks`, { method: 'POST', body: { answers: answers.map(({ key, choice }) => ({ key, choice })) } });
      celebrate(r.badges);
      if (L.enrolled && !done) {
        const c = await call(`lessons/${L.lesson.id}/complete`, { method: 'POST', body: { contentId: L.content.id } });
        lines.push(c.queued ? t('Saved on this phone: it goes to your record when there\'s signal') : c.preview ? t('Recorded: done in a preview translation') : c.enrolment?.state === 'completed' ? t('Lesson complete: programme complete!') : t('Lesson complete'));
        celebrate(c.badges);
        const h = $('lpFinish')?.querySelector('h2'); if (h) h.textContent = t('You\'ve completed this lesson');
      } else if (r.queued) lines.push(t('Saved on this phone: it\'s sent when there\'s signal.'));
      lines.push(t('These questions come back as refreshers when they\'re due.'));
    } catch (e) { ok = false; lines.push(e.message); }
    note.innerHTML = lines.map((x) => `<span>${esc(x)}</span>`).join('<br>');
    const next = $('lpNextWrap');
    if (ok && next) { next.hidden = false; next.querySelector('a')?.focus(); }
  });
  if (sec.dataset.answered === '1') {
    sec.querySelector('[data-check-again]').onclick = () => { const box = document.createElement('div'); sec.querySelector('.note').replaceWith(box); run(box); };
  } else run($('lpQuiz'));
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
hooks.overview.push(async () => {
  let p; try { p = await progress(); } catch { return ''; }
  const due = p.refresher.reduce((n, r) => n + r.due, 0), practised = p.refresher.reduce((n, r) => n + r.practised, 0);
  const earned = p.badges.filter((b) => b.earned);
  return `<section class="card keepSharp"><h2>Keep sharp</h2>
      <div class="sharpGrid">${streakStrip(p.streak)}
      <div class="refresherBox"><p>${practised ? esc(due ? t('{n} refresher questions are due.', { n: due }) : t('No refresher questions are due right now.')) : esc(t('Finish a lesson and its quick check: its questions come back here as refreshers.'))}</p>
        ${practised ? `<a class="btnLink${due ? ' primaryLink' : ''}" href="#/refresh${due ? '' : '?more=1'}">${due ? 'Start a refresher' : 'Practise anyway'}</a>` : ''}</div></div>
      <div class="badgeRow">${earned.length ? earned.slice(-8).map((b) => badgeIcon(b, 'sm')).join('') : `<span class="note">${esc(t('No badges yet: your first comes with your first lesson.'))}</span>`}
        <a href="#/badges" class="badgeAll">${esc(t('All badges ({n} of {total})', { n: earned.length, total: p.badges.length }))}</a></div></section>`;
});
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
