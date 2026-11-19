// The assessments' demonstration question banks (step 4), loaded by scripts/learn-seed.mjs. The OCR questions come from the brief's
// sections 4 (obstacle types) and 6 (burpee standard), written against the 2026 rule numbers and marked where the 2026 sources
// disagree. The video judgement uses the site's own animated figure (no third-party footage). DEKA's are placeholders.

import { CAMERA_ASSESSMENT } from './learn-camera-course.mjs';

export const ASSESSMENTS = {
  'camera-station': CAMERA_ASSESSMENT,
  'ocr-referee': {
    title: 'OCR Referee knowledge check',
    description: 'Eight questions on obstacle types, the Spear Throw and the burpee standard, from the 2026 rulebook. One is a video judgement an assessor confirms.',
    questions: [
      { type: 'single', rules: ['OCR-2026-4.2.13'], prompt: 'Under the 2026 rulebook, when does a Spear Throw attempt start?',
        options: [{ text: 'When the athlete draws the spear back to throw' }, { text: 'When the athlete releases the spear in a forward motion', correct: true }, { text: 'When the athlete steps up to the barrier' }, { text: 'When the spear reaches the target' }],
        feedback: 'Rule 4.2.13 (c1): once the spear is released in a forward motion, it is an attempt. The 2026 online programme says commitment starts earlier, on the draw back: that difference is under review for 2027.',
        review: 'Linked to a point under review for 2027: the rulebook and the 2026 online programme disagree on when commitment starts.' },
      { type: 'single', rules: ['OCR-2026-4.2.13'], prompt: 'A spear brushes the ground in flight, then sticks in the target with no part touching the ground. What is the call?',
        options: [{ text: 'Pass', correct: true }, { text: 'Fail: it touched the ground' }, { text: 'The athlete throws again' }, { text: 'Refer it to the Head Referee before deciding' }],
        feedback: 'Rule 4.2.13 (c4): a spear may touch the ground during an attempt, as long as it isn\'t touching the ground once it is stationary in the target. The 2026 programme treats it as a fail: under review for 2027.',
        review: 'Linked to a point under review for 2027: the rulebook and the 2026 online programme disagree on a spear touching the ground in flight.' },
      { type: 'multiple', rules: ['OCR-2026-4.2.13'], prompt: 'Which of these are failures at the Spear Throw? Choose all that apply.',
        options: [{ text: 'The spear doesn\'t embed in the indicated target', correct: true }, { text: 'Part of the spear touches the ground once it is still', correct: true }, { text: 'The athlete changes lanes before throwing' }, { text: 'The athlete waits to see the spear hit before moving away' }],
        feedback: 'Rule 4.2.13 (b): the two failure modes are not embedding in the indicated target, and the spear touching the ground once stationary. Changing lanes is allowed before an attempt, and the athlete must wait for the spear to land.' },
      { type: 'single', rules: ['OCR-2026-4.2.13', 'OCR-2026-3.17.3'], prompt: 'An athlete fails the Spear Throw at a Super. What is the penalty?',
        options: [{ text: '30 burpees', correct: true }, { text: '15 burpees' }, { text: 'The penalty loop' }, { text: 'A 10-minute time penalty' }],
        feedback: 'Rule 4.2.13 (c6): the penalty for failing the Spear Throw is 30 burpees. 15 burpees is the Stadion penalty (3.17.3).' },
      { type: 'single', rules: ['OCR-2026-3.17.5'], prompt: 'Where must penalty burpees be done?',
        options: [{ text: 'In the designated burpee zone', correct: true }, { text: 'Anywhere near the obstacle' }, { text: 'Wherever the athlete has room' }, { text: 'At the next obstacle' }],
        feedback: 'Rule 3.17.5: burpees must be completed in the designated burpee zone. Burpees outside it don\'t count towards the penalty.' },
      { type: 'multiple', rules: ['OCR-2026-3.17.4'], prompt: 'Which of these are part of one complete burpee under rule 3.17.4? Choose all that apply.',
        options: [{ text: 'Chest touching the ground at the bottom', correct: true }, { text: 'Hips and knees extended in a balanced upright position at the top', correct: true }, { text: 'A jump with the hands extended above the ears', correct: true }, { text: 'A clap behind the head' }],
        feedback: 'Rule 3.17.4: one burpee goes from the bottom position (lying prone, chest touching the ground) to the top position (upright, hips and knees extended), followed by a jump with the hands above the ears.' },
      { type: 'single', rules: ['OCR-2026-3.17.4'], prompt: 'At the burpee zone, who counts the athlete\'s burpees?',
        options: [{ text: 'The athlete counts their own', correct: true }, { text: 'The referee counts them aloud' }, { text: 'The timing team' }, { text: 'Nobody: only the camera does' }],
        feedback: 'The 2026 online programme (6.2): athletes count their own burpees; referees watch the movement standard and ask for extra burpees when one doesn\'t meet it.' },
      { type: 'video', rules: ['OCR-2026-3.17.4'], needsAssessor: true, clip: { anim: 'burpee', variant: 'noJump' },
        prompt: 'Watch the athlete\'s burpees. Do they meet the 2026 movement standard? Choose your call and say why.',
        options: [{ text: 'Yes: they count' }, { text: 'No: the chest doesn\'t reach the ground' }, { text: 'No: there is no jump with the hands above the ears', correct: true }, { text: 'Can\'t tell: refer it to the Head Referee' }],
        feedback: 'The athlete stands up but never jumps with the hands above the ears (3.17.4c), so these don\'t meet the standard: ask for extra burpees. An assessor checks your reasons.' },
    ],
  },
  'deka-judge': {
    title: 'DEKA sample quiz (placeholder)',
    description: 'Three placeholder questions showing a second programme\'s own quiz, pass mark and credential. Not DEKA rules.',
    questions: [
      { type: 'single', rules: [], prompt: 'In this sample programme, what does a judge do with a rep that doesn\'t meet the standard?',
        options: [{ text: 'Calls a no-rep clearly', correct: true }, { text: 'Counts it anyway' }, { text: 'Stops the athlete' }], feedback: 'Placeholder: in the sample lesson, a judge calls a no-rep clearly.' },
      { type: 'single', rules: [], prompt: 'Is this placeholder content DEKA\'s official rules?',
        options: [{ text: 'No: it is a demonstration placeholder', correct: true }, { text: 'Yes' }], feedback: 'Correct: nothing in this programme is DEKA\'s rules until its owners supply material.' },
      { type: 'multiple', rules: [], prompt: 'Which of these does each programme keep separately? Choose all that apply.',
        options: [{ text: 'Its lessons', correct: true }, { text: 'Its pass mark', correct: true }, { text: 'Its credential', correct: true }, { text: 'Your profile' }], feedback: 'Each programme has its own lessons, assessment, pass mark and credential; your profile is shared.' },
    ],
  },
};

// demonstration states (the design doc's demo data): who has passed what, and how old their credential is
export const OUTCOMES = [
  { email: 'ben.taylor', programme: 'ocr-referee', issuedDaysAgo: 30, note: 'passed: active credential' },
  { email: 'chaiwat.srisuk', programme: 'ocr-referee', issuedDaysAgo: 340, note: 'credential due for renewal' },
  { email: 'daniyal.khan', programme: 'deka-judge', issuedDaysAgo: 760, note: 'credential expired' },
  { email: 'anna.kowalska', programme: 'deka-judge', issuedDaysAgo: 12, note: 'DEKA passed; OCR still in progress' },
];
