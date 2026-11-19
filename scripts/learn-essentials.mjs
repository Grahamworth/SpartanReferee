// Referee Essentials (19 November 2026): a short course for new referees, from the "Spartan Referee 2026 Mobile Prototype" deck: five
// modules (welcome, race day, obstacle logic, penalty logic, conduct), each one lesson, its "make the call" questions as the lessons'
// quick checks (scripts/learn-checks.json). Written in our own words and checked against the 2026 rulebook; where the 2026 sources
// disagree (the time for missed burpees) the slide says it's under review, as the OCR programme does. In all 15 languages.

const R = (n) => `OCR-2026-${n}`;
export const ESSENTIALS = {
  id: 'referee-essentials', code: 'ess', title: 'Referee Essentials', category: 'referee', learnerRole: 'Referee', locales: 'en,fr,de,nl,es,it,el,hr,cs,pl,fi,sv,da,ar,th',
  description: 'A short course for new referees: what a referee is for, race day, the three kinds of obstacle, penalties and the burpee standard, and conduct. From the Spartan Referee 2026 mobile prototype.',
  version: {
    edition: '2027', completionRule: 'lessons', passMark: 80, maxAttempts: null, retakeWaitHours: 0, validityMonths: 12, renewalDueDays: 60,
    qualification: 'Referee Essentials', policyNote: 'An introduction: completing it is not an official Spartan qualification.',
  },
  modules: [
    { title: 'Welcome', source: '2026 mobile prototype, module 1', summary: 'Why referees matter, the referee code and the categories.', lessons: [
      { key: 'ess-1-1', title: 'The referee makes the call', minutes: 3, summary: 'Fair, consistent, ready: the mission, the code and who you are judging.' }] },
    { title: 'Race day', source: '2026 mobile prototype, module 2', summary: 'From check-in to sign-off.', lessons: [
      { key: 'ess-2-1', title: 'From check-in to sign-off', minutes: 4, summary: 'The race-day steps, owning your obstacle, and the chain to escalate through.' }] },
    { title: 'Obstacle logic', source: '2026 mobile prototype, module 3', summary: 'Three types of obstacle, three rule paths.', lessons: [
      { key: 'ess-3-1', title: 'Three types, three rule paths', minutes: 5, summary: 'Mandatory, multiple attempt and single attempt, and the Spear Throw.' }] },
    { title: 'Penalty logic', source: '2026 mobile prototype, module 4', summary: 'The right penalty, the burpee standard and missed burpees.', lessons: [
      { key: 'ess-4-1', title: 'The penalty must match', minutes: 5, summary: 'Loops and burpees, skipping a penalty, the burpee standard and missed burpees.' }] },
    { title: 'Conduct', source: '2026 mobile prototype, module 5', summary: 'Athlete questions, reporting, neutrality and where to stand.', lessons: [
      { key: 'ess-5-1', title: 'Your call, their race', minutes: 4, summary: 'Calm answers, factual reports, staying neutral, and seeing the deciding moment.' }] },
  ],
};

const SOURCES = 'Spartan Referee 2026 mobile prototype (deck). Spartan OCR Rules of Competition 2026.';
const anim = (src) => ({ media: { type: 'anim', src } });
export const ESSENTIALS_LESSONS = {
  'ess-1-1': { sources: SOURCES, en: [
    { heading: 'One race, one standard', figure: 'athletes', rules: [R('1.2.1')],
      points: ['Spartan challenges every athlete', 'Referees protect the fairness of that challenge', 'Protect integrity, treat everyone equally, keep it fair'],
      narration: 'Spartan challenges every athlete who starts a race. Your job as a referee is to protect the fairness of that challenge: protect the integrity of the race, treat every athlete equally, and keep it fair.' },
    { heading: 'Your referee code', figure: 'referee',
      points: ['Be impartial: judge the action, never the athlete', 'Safety first: spot danger and report it at once', 'Follow the rules: the same standard every time', 'Escalate doubt: take it to the Head Referee'],
      narration: 'Four things are not negotiable. Be impartial: judge the action, never the athlete. Put safety first: spot danger and report it at once. Follow the rules, applying the same standard every time. And when you are in doubt, take it to the Head Referee.' },
    { heading: 'Know who you are judging', figure: 'athletes', rules: [R('2.1.1')],
      points: ['Two categories: Competitive (Elite and Age Group) and Open', 'Open is about taking part', 'Always follow the event\'s instructions for each category'],
      narration: 'Athletes race in two categories. Competitive is the Elite and Age Group racers. Open is about taking part. The two can be run differently, so always follow the event\'s instructions for the category in front of you.' },
    { heading: 'In short', figure: 'summary',
      points: ['You protect a fair challenge for everyone', 'Impartial, safe, consistent, and escalate doubt', 'Know the category, and follow the event\'s instructions'],
      narration: 'In short. You protect a fair challenge for every athlete. Be impartial, put safety first, be consistent, and escalate doubt. Know which category you are judging, and follow the event\'s instructions.' },
  ] },
  'ess-2-1': { sources: SOURCES, en: [
    { heading: 'From check-in to sign-off', figure: 'clipboard',
      points: ['Briefing', 'Check-in', 'Inspection', 'Officiating', 'Handover', 'Report'],
      narration: 'Race day is six steps and one continuous responsibility: the briefing, check-in, inspecting your obstacle, officiating, handing over, and reporting.' },
    { heading: 'Show up race-ready', figure: 'clipboard',
      points: ['Check in and confirm your assignment', 'Collect your kit and the rules', 'Join the event\'s radio or chat if there is one', 'Report to the Head Referee'],
      narration: 'Arrive race-ready. Check in and confirm where you are assigned. Collect your kit and the rules. Join the event\'s radio or chat if it has one, and report to the Head Referee.' },
    { heading: 'Own your obstacle', figure: 'wall',
      points: ['Know the rule: success, failure and the penalty', 'Inspect for safety: the setup and any hazards', 'Walk the route: how athletes flow, and the penalty loop', 'Choose your view, and brief any marshals'],
      narration: 'Get your obstacle ready before the first athlete arrives. Know its rule: what success looks like, what a failure is, and the penalty. Inspect it for safety. Walk the route, including the penalty loop. Then choose where you will stand, and brief any marshals.' },
    { heading: 'If in doubt, escalate', figure: 'radio',
      points: ['Referee: observe, apply the rule, record', 'Head Referee: review, direct, interpret', 'Race Director or timing: further action where needed'],
      narration: 'Follow the chain. You observe, apply the rule and record what happened. The Head Referee reviews, directs and interprets. The Race Director or the timing team take further action where it is needed. If you are in doubt, escalate.' },
    { heading: 'In short', figure: 'summary',
      points: ['Six steps, one responsibility', 'Know the rule, inspect, walk the route, choose your view', 'Escalate through the Head Referee'],
      narration: 'In short. Race day is six steps and one responsibility. Know your obstacle\'s rule, inspect it, walk the route and choose your view. And escalate through the Head Referee.' },
  ] },
  'ess-3-1': { sources: SOURCES, en: [
    { heading: 'Three types, three rule paths', figure: 'wall', rules: [R('3.17.1')],
      points: ['Mandatory: it must be completed', 'Multiple attempt: the athlete may try again', 'Single attempt: when the attempt starts matters'],
      narration: 'Recognise the kind of obstacle before you make a call. A mandatory obstacle must be completed. At a multiple attempt obstacle the athlete may try again. At a single attempt obstacle, the moment the attempt starts changes the call.' },
    { heading: 'Mandatory: complete it or face disqualification', figure: 'athletes', rules: [R('3.17.2')], ...anim('sandbag'),
      points: ['The athlete must finish it before going on', 'For example the carries, the barbed wire crawl and the fire jump', 'The Race Director may give a time penalty instead of disqualification'],
      narration: 'A mandatory obstacle has to be completed before the athlete goes on. The carries, the barbed wire crawl and the fire jump are examples. Failing one normally means disqualification, though the Race Director may give a time penalty instead.' },
    { heading: 'Multiple attempt: try again or take the penalty', figure: 'wall', ...anim('rope'),
      points: ['For example the Rope Climb, the Hercules Hoist and the walls', 'The athlete may keep trying until it is done', 'Or give up, and take the penalty'],
      narration: 'At a multiple attempt obstacle, such as the Rope Climb, the Hercules Hoist or the walls, the athlete may keep trying until it is done, or give up and take the penalty.' },
    { heading: 'Single attempt: commitment changes the call', figure: 'release', ...anim('multirig'),
      points: ['Each obstacle\'s rule says when the attempt starts', 'Before that point, the athlete may still reset', 'After it, a fail means the penalty', 'For example the Monkey Bars, the Multi-Rig and the Z Wall'],
      narration: 'At a single attempt obstacle, each obstacle\'s rule says when the attempt starts. Before that point the athlete may still reset. After it, a fail means the penalty. The Monkey Bars, the Multi-Rig and the Z Wall are examples.' },
    { heading: 'Spear Throw: four things to watch', figure: 'target', rules: [R('4.2.13')], ...anim('spear'),
      points: ['Both feet behind the barrier', 'A throw at the target in the same lane', 'The spear sticks in the target and stays there', 'The athlete moves 2 metres away before it counts'],
      narration: 'The Spear Throw is single attempt. Watch four things: both feet behind the barrier, a throw at the target in the athlete\'s own lane, the spear sticking in the target and staying there, and the athlete moving two metres away before it counts. Once the spear has stopped, no part of it may touch the ground.' },
    { heading: 'In short', figure: 'summary',
      points: ['Mandatory: complete it, or it is normally disqualification', 'Multiple attempt: try again or take the penalty', 'Single attempt: know when the attempt starts'],
      narration: 'In short. A mandatory obstacle must be completed, or it is normally disqualification. At a multiple attempt obstacle the athlete may try again or take the penalty. At a single attempt obstacle, know exactly when the attempt starts.' },
  ] },
  'ess-4-1': { sources: SOURCES, en: [
    { heading: 'The penalty must match', figure: 'loop', rules: [R('3.17.2')],
      points: ['The designated penalty loop, all of it', 'Or, where the event says so, 30 burpees (15 at Stadion events)', 'Never give a penalty of your own', 'Failing a mandatory obstacle normally means disqualification, not a loop'],
      narration: 'The penalty has to be the one the event sets. That is the whole of the designated penalty loop or, where the event says so, thirty burpees, or fifteen at Stadion events. Never give a penalty of your own. And failing a mandatory obstacle normally means disqualification, not a loop.' },
    { heading: 'Skipping the penalty loop', figure: 'loop', rules: [R('3.4.1')],
      points: ['An athlete fails a pass/fail obstacle and skips the loop', '10 minutes are added to their finish time', 'It can be found on course or in the review before the awards'],
      narration: 'If an athlete fails a pass or fail obstacle and doesn\'t complete the penalty loop, ten minutes are added to their finish time. It can be found on course, or in the review before the awards.' },
    { heading: 'Watch the whole rep', figure: 'burpee', rules: [R('3.17.4')], ...anim('burpee'),
      points: ['Chest to the ground at the bottom', 'Hips and knees fully extended at the top', 'A jump with the hands above the ears'],
      narration: 'A burpee counts when you see all three parts: the chest on the ground at the bottom, the hips and knees fully extended at the top, and a jump with the hands above the ears.' },
    { heading: 'Observe, don\'t coach', figure: 'referee',
      points: ['The athlete counts their own burpees', 'They may repeat one they are unsure of', 'You watch the standard, and help video review'],
      narration: 'The athlete counts their own burpees, and may repeat one they are unsure of. Your part is to watch the standard and to help video review, not to coach.' },
    { heading: 'Missed burpees: know the scale', figure: 'burpee', rules: [R('3.4.2')],
      points: ['30 seconds for each of the first 10 missed', 'More than 10 missed: 10 minutes in total', 'Stadion: 30 seconds each for the first 5; more than 5 is 5 minutes'],
      narration: 'Under rule 3.4.2, each of the first ten missed burpees adds thirty seconds. More than ten missed adds ten minutes in total. At Stadion events it is thirty seconds each for the first five, and five minutes for more than five.',
      review: 'Under review for 2027: the Officiating SOP and the 2026 programme give different figures for missed burpees. Apply the rulebook, and the Head Referee confirms every penalty.' },
    { heading: 'In short', figure: 'summary',
      points: ['The event\'s penalty, all of it, and never your own', 'Skipping the loop adds 10 minutes', 'Chest down, fully upright, jump with hands above the ears'],
      narration: 'In short. Give the event\'s penalty, all of it, and never one of your own. Skipping the loop adds ten minutes. And a burpee is chest down, fully upright, then a jump with the hands above the ears.' },
  ] },
  'ess-5-1': { sources: SOURCES, en: [
    { heading: 'Be clear, keep it calm', figure: 'referee', rules: [R('3.19.3')],
      points: ['Explain the rule briefly, respectfully and accurately', 'Don\'t argue: refer a challenge to the Head Referee'],
      narration: 'Professional conversations stop disputes growing. Explain the rule briefly, respectfully and accurately. Don\'t argue: refer a challenge to the Head Referee.' },
    { heading: 'Evidence beats opinion', figure: 'clipboard',
      points: ['The headband number', 'The obstacle and where it is', 'What you saw', 'When it happened', 'Who you told'],
      narration: 'Give the Head Referee an accurate record: the headband number, the obstacle and where it is, what you saw, when it happened, and who you told.' },
    { heading: 'Stay focused, stay neutral', figure: 'safety', rules: [R('3.5.1')],
      points: ['Watch the action', 'Avoid any bias', 'Protect safety', 'Never coach an athlete during an attempt'],
      narration: 'Your position is one of trust. Watch the action, avoid any bias, and protect safety. Never coach an athlete during an attempt.' },
    { heading: 'See the deciding moment', figure: 'referee', ...anim('olympus'),
      points: ['Approach: know the entry and the lane boundaries', 'Action: see any contact that isn\'t allowed, or a failure', 'Finish: see the success condition, such as the bell', 'Expect the failures, and keep your view clear'],
      narration: 'A good call starts with a clear view. Know where athletes enter and where the lane boundaries are. Watch for any contact that isn\'t allowed, or a failure. See the success condition, such as the bell. Expect where failures happen, and keep your view clear.' },
    { heading: 'Five rules for race day', figure: 'summary',
      points: ['Safety first', 'Consistency always', 'Know the obstacle', 'Give the correct penalty', 'Escalate uncertainty'],
      narration: 'Five rules to take to race day. Safety first. Consistency always. Know the obstacle. Give the correct penalty. And escalate uncertainty.' },
  ] },
};

// the quick checks, from the deck's "make the call" questions and the slides (merged into scripts/learn-checks.json)
export const ESSENTIALS_CHECKS = {
  'ess-1-1': [
    { prompt: 'An athlete you know well arrives at your obstacle. What do you judge?', options: ['Their effort', 'The action against the rule, as for anyone', 'Whether they are likely to win'], answer: 1, feedback: 'Be impartial: judge the action, never the athlete.', rules: [] },
    { prompt: 'Which two categories do athletes race in?', options: ['Competitive and Open', 'Elite and Beginner', 'Ultra and Sprint'], answer: 0, feedback: 'Competitive (Elite and Age Group) and Open.', rules: [R('2.1.1')] },
  ],
  'ess-2-1': [
    { prompt: 'You notice your wall\'s structure may be unsafe, and athletes are coming. What do you do?', options: ['Keep the race moving and mention it later', 'Alert event staff at once and follow the safety escalation', 'Ask the next athlete to test it'], answer: 1, feedback: 'Safety first: report a hazard at once, through the chain.', rules: [] },
    { prompt: 'Who do you take a call you are unsure about to?', options: ['The athlete', 'The Head Referee', 'The nearest spectator'], answer: 1, feedback: 'If in doubt, escalate: the Head Referee reviews, directs and interprets.', rules: [] },
  ],
  'ess-3-1': [
    { prompt: 'At the Spear Throw, the athlete has picked up the spear but not released it. May they reset or change lanes?', options: ['Yes, before a forward release', 'No: picking up the spear commits them', 'Only if the referee allows it'], answer: 0, feedback: 'The attempt starts when the spear is released forward. Before that, they may change lanes.', rules: [R('4.2.13')] },
    { prompt: 'The spear brushes the ground in flight, then sticks in the target, and nothing touches the ground once it stops. What now?', options: ['A fail: it touched the ground', 'Judge it on everything else: touching the ground in flight isn\'t a fail on its own', 'A pass, whatever else happened'], answer: 1, feedback: 'Only touching the ground once it has stopped is a fail. Check the other conditions as usual.', rules: [R('4.2.13')] },
    { prompt: 'An athlete fails a mandatory obstacle. What normally follows?', options: ['A penalty loop', 'Disqualification, unless the Race Director gives a time penalty', '30 burpees'], answer: 1, feedback: 'Mandatory obstacles have no penalty to take instead: failing one normally means disqualification.', rules: [R('3.17.2')] },
  ],
  'ess-4-1': [
    { prompt: 'An athlete fails a pass/fail obstacle and runs past the penalty loop. What applies?', options: ['Nothing, if their attempt was close', 'A 10 minute time penalty', 'Disqualification straight away'], answer: 1, feedback: 'Rule 3.4.1: skipping the penalty loop adds 10 minutes to the finish time.', rules: [R('3.4.1')] },
    { prompt: 'After review, an athlete at a standard OCR race missed 12 of their 30 burpees. What does the rulebook add?', options: ['6 minutes', '10 minutes in total', 'Disqualification'], answer: 1, feedback: 'Rule 3.4.2: more than 10 missed is 10 minutes in total. The Head Referee confirms the penalty.', rules: [R('3.4.2')] },
    { prompt: 'Which three things make a burpee count?', options: ['Chest to the ground, fully upright, a jump with the hands above the ears', 'Hands on the ground, a squat, a clap', 'Ten in a row without stopping'], answer: 0, feedback: 'Chest down at the bottom, hips and knees extended at the top, then the jump with the hands above the ears.', rules: [R('3.17.4')] },
  ],
  'ess-5-1': [
    { prompt: 'Your view was blocked at the moment the athlete may have rung the bell. What is the professional response?', options: ['Assume they rang it: they looked confident', 'Assume they didn\'t: you didn\'t hear it', 'Record what you saw and ask the Head Referee to decide'], answer: 2, feedback: 'Report the facts you saw, and let the Head Referee decide with any evidence.', rules: [] },
    { prompt: 'What goes in your report of an incident?', options: ['Your opinion of the athlete', 'The headband number, the obstacle, what you saw, when, and who you told', 'Only the penalty you gave'], answer: 1, feedback: 'Evidence beats opinion: the facts the Head Referee needs.', rules: [] },
  ],
};
