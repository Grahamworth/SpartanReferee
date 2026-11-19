// The learning platform's demonstration content, loaded by scripts/learn-seed.mjs: the programmes and their curriculum (step 2),
// lesson scripts (step 3), questions (step 4) and rule references (step 5).
// The OCR curriculum follows the nine sections of Spartan's 2026 Referee Online Program (the brief's section 6), as a content map
// for review: none of it is approved 2027 instructional copy, and DEKA is an obvious placeholder until its owners supply material.

import { CAMERA } from './learn-camera-course.mjs';
import { ESSENTIALS } from './learn-essentials.mjs';

export const OCR = {
  id: 'ocr-referee', title: 'Spartan OCR Referee', category: 'referee', learnerRole: 'OCR Referee', locales: 'en,fr,de,nl,es,it,el,hr,cs,pl,fi,sv,da,ar,th',
  description: 'The online programme for Spartan obstacle course race referees: the rules, the race-day workflow, obstacles, penalties, the burpee standard and conduct. Built from the 2026 programme as a map for the 2027 edition.',
  version: {
    edition: '2027', completionRule: 'lessons+assessment', passMark: 80, maxAttempts: 3, retakeWaitHours: 24, validityMonths: 12, renewalDueDays: 60,
    qualification: 'OCR Referee 2027', policyNote: 'Sample policy for the demonstration: the officiating lead sets the real pass mark, attempts and validity.',
  },
  modules: [
    { title: 'Spartan Racing', source: '2026 programme, section 1', summary: 'Purpose, race context and the categories athletes race in.', lessons: [
      { key: 'ocr-1-1', title: 'Challenge with purpose', minutes: 4, summary: 'Why Spartan exists, and who it is for.' },
      { key: 'ocr-1-2', title: 'What a Spartan Race is', minutes: 4, summary: 'Trail running with obstacles: climbing, carrying, crawling, jumping, pulling and lifting.' }] },
    { title: 'Role of Referees', source: '2026 programme, section 2', summary: 'Impartiality, responsibility and mindset.', lessons: [
      { key: 'ocr-2-1', title: 'Why referees matter', minutes: 5, summary: 'Fairness, race integrity and credible competitive racing.' },
      { key: 'ocr-2-2', title: 'Competition categories', minutes: 4, summary: 'Elite, Age Group and Open, and where referees focus.' },
      { key: 'ocr-2-3', title: 'The referee mindset and event timeline', minutes: 5, summary: 'Impartial, professional, safety first; the referee\'s day from briefing to handover.' }] },
    { title: 'Race Day Workflow', source: '2026 programme, section 3', summary: 'Check-in, equipment, obstacle preparation and communication.', lessons: [
      { key: 'ocr-3-1', title: 'Check-in and equipment', minutes: 5, summary: 'Morning check-in, what to bring and wear, and getting your kit (Officiating SOP 5.2.1 and 7).' },
      { key: 'ocr-3-2', title: 'Preparing your obstacle', minutes: 5, summary: 'Officiating SOP 5.2.2: rules, setup, the penalty loop and where to stand.' },
      { key: 'ocr-3-3', title: 'The communication chain', minutes: 3, summary: 'Referee, Head Referee, Race Director or timing team.' }] },
    { title: 'Obstacle Types', source: '2026 programme, section 4', summary: 'Mandatory, multiple-attempt and single-attempt obstacles, and each one\'s failure conditions.', lessons: [
      { key: 'ocr-4-1', title: 'Understanding obstacle types', minutes: 6, summary: 'Mandatory, multiple-attempt and single-attempt. Which obstacle is which is under review for 2027.' },
      { key: 'ocr-4-2', title: 'Spear Throw: commitment and failure', minutes: 7, summary: 'A single-attempt obstacle, end to end: when the athlete commits, what counts as a fail, and the penalty.' }] },
    { title: 'Penalty Rules', source: '2026 programme, section 5', summary: 'Penalty procedures and enforcement. Subject to the 2027 rules review.', lessons: [
      { key: 'ocr-5-1', title: 'Penalty standards', minutes: 5, summary: 'Penalty loops, burpee deficits and what not completing a penalty means.' },
      { key: 'ocr-5-2', title: 'Obstacle enforcement and athlete conduct', minutes: 5, summary: 'Instructions, violations, directing to the penalty, and reporting.' },
      { key: 'ocr-5-3', title: 'Burpee penalty basics', minutes: 4, summary: 'Where burpees are the penalty, the zone and the camera.' }] },
    { title: 'Burpee Standard', source: '2026 programme, section 6', summary: 'The movement, how it is monitored, and time penalties. Subject to the 2027 rules review.', lessons: [
      { key: 'ocr-6-1', title: 'The burpee movement standard', minutes: 5, summary: 'Chest to the ground, hips extended, a jump with hands above the ears, one continuous movement.' },
      { key: 'ocr-6-2', title: 'Enforcing the standard', minutes: 5, summary: 'Athletes count; referees watch the standard and ask for extra reps.' },
      { key: 'ocr-6-3', title: 'Burpee time penalties', minutes: 4, summary: 'Missed or incorrect burpees and the time they add. Under review: the sources disagree.' }] },
    { title: 'Disputes and Conduct', source: '2026 programme, section 7', summary: 'Athlete interactions, logging and escalation.', lessons: [
      { key: 'ocr-7-1', title: 'Questions and disputes', minutes: 5, summary: 'Officiating SOP 5.2.4: stay calm, explain, record, refer to the Head Referee.' }] },
    { title: 'Professional Conduct', source: '2026 programme, section 8', summary: 'Focus, authority, consistency and safety.', lessons: [
      { key: 'ocr-8-1', title: 'Conduct and authority', minutes: 5, summary: 'Staying focused and neutral, and what a referee decides.' },
      { key: 'ocr-8-2', title: 'Safety and consistency', minutes: 5, summary: 'Safe movement, hazards, and the same interpretation all race.' }] },
    { title: 'Referee Scenarios', source: '2026 programme, section 9', summary: 'Practical decisions, video judgements and discussion.', lessons: [
      { key: 'ocr-9-1', title: 'Observation and positioning', minutes: 5, summary: 'Where to stand and what to watch.' },
      { key: 'ocr-9-2', title: 'Common rule violations', minutes: 5, summary: 'Support structures, penalty loops, burpees and the bell.' },
      { key: 'ocr-9-3', title: 'Scenario exercises', minutes: 10, summary: 'Three situations to decide, with discussion.' }] },
  ],
};

export const DEKA = {
  id: 'deka-judge', title: 'DEKA Judge (placeholder)', category: 'judge', learnerRole: 'DEKA Judge', locales: 'en',
  description: 'A placeholder programme showing how a second programme sits beside OCR with its own lessons, assessment, pass mark and credential. Its content is invented until DEKA\'s programme owners supply real material.',
  version: {
    edition: '2027', completionRule: 'lessons+assessment', passMark: 70, maxAttempts: null, retakeWaitHours: 0, validityMonths: 24, renewalDueDays: 60,
    qualification: 'DEKA Judge 2027 (placeholder)', policyNote: 'Placeholder policy and content: not DEKA rules.',
  },
  modules: [
    { title: 'DEKA judging basics (placeholder)', source: 'Placeholder: awaiting DEKA material', summary: 'Shows a separate programme\'s lesson and quiz. Not DEKA rules.', lessons: [
      { key: 'deka-1-1', title: 'What a DEKA judge does (sample)', minutes: 4, summary: 'A sample lesson for the demonstration.' }] },
  ],
};

export const PROGRAMMES = [OCR, DEKA, CAMERA, ESSENTIALS];

// who's enrolled in what, and the state each shows (the design doc's demo data)
export const ENROLMENTS = [
  { email: 'anna.kowalska', programmes: ['ocr-referee', 'deka-judge'] },
  { email: 'ben.taylor', programmes: ['ocr-referee'] },
  { email: 'chaiwat.srisuk', programmes: ['ocr-referee'] },
  { email: 'daniyal.khan', programmes: ['deka-judge'] },
];
