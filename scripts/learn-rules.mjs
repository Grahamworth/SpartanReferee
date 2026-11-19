// Rule references and open review items for the learning platform's demonstration (step 5), loaded by scripts/learn-seed.mjs.
// The rule references are sections of Spartan's own 2026 rulebook that the demonstration lesson and questions cite, with short excerpts.
// The 2026 documents are a baseline, not approved for 2027 (RUL-04). Where the 2026 rulebook, Officiating SOP and online programme
// disagree, an open review item says so (the design doc's "Conflicts in the 2026 material"), until the officiating lead rules.

import { OCR_RULES, OCR_DISPUTES } from './learn-ocr-lessons.mjs';

export const DOCUMENTS = [
  { id: 'ocr-rules-2026', programme: 'ocr-referee', title: 'Spartan OCR Rules of Competition', edition: '2026', approval: 'baseline', effective: '2026-01-01',
    note: 'The 2026 rulebook: the baseline for the 2027 programme, not approved 2027 rules.' },
  { id: 'ocr-sop-2026', programme: 'ocr-referee', title: 'Spartan Officiating Standard Operating Procedure', edition: '2026', approval: 'baseline', effective: '2026-01-01',
    note: 'The 2026 SOP: procedures for referees, Head Referees and video review.' },
  { id: 'ocr-programme-2026', programme: 'ocr-referee', title: 'Spartan Referee Online Program (presentation)', edition: '2026', approval: 'baseline', effective: '2026-01-01',
    note: 'The 2026 teaching slides: a content baseline, not rule text.' },
];

const R = 'ocr-rules-2026';
export const RULES = [
  { id: 'OCR-2026-2.1.5', doc: R, section: '2.1.5', title: 'Mandatory obstacles', excerpt: 'Any obstacle which a competitor must complete before progressing further on the course during a race.' },
  { id: 'OCR-2026-2.1.6', doc: R, section: '2.1.6', title: 'Multiple attempt (pass/fail) obstacles', excerpt: 'Any obstacles that may be attempted as many times as necessary until successful completion or a penalty is awarded.' },
  { id: 'OCR-2026-2.1.7', doc: R, section: '2.1.7', title: 'Single attempt (pass/fail) obstacles', excerpt: 'Any obstacle where once a competitor has committed to an attempt as defined within the specific rules for that obstacle, the obstacle must be completed successfully or a penalty will be awarded.' },
  { id: 'OCR-2026-3.4.1', doc: R, section: '3.4.1', title: 'Penalty loop not completed', excerpt: 'If a competitor attempted and failed a Pass/Fail obstacle but did not complete the mandatory penalty loop, a 10 minute time penalty shall be added to their overall finish time.' },
  { id: 'OCR-2026-3.4.2', doc: R, section: '3.4.2', title: 'Burpees not completed', excerpt: 'A 30-second penalty for each of the first 10 missed burpees; if more than 10 are missed, a total penalty of 10 minutes. Stadion (15 burpees): 30 seconds for each of the first 5 missed, 5 minutes for more than 5.' },
  { id: 'OCR-2026-3.17.3', doc: R, section: '3.17.3', title: 'The penalty for pass/fail obstacles', excerpt: 'Spartan OCR: a penalty loop or 30 burpees, as designated by Spartan Race for each obstacle, event, category or heat. Stadion: always 15 burpees.' },
  { id: 'OCR-2026-3.17.4', doc: R, section: '3.17.4', title: 'One complete burpee', excerpt: 'One cycle from the bottom position (lying prone, chest touching the ground) to the top position (balanced and upright, hips and knees extended), followed by a jump with the hands extended upwards above the ears.' },
  { id: 'OCR-2026-3.17.5', doc: R, section: '3.17.5', title: 'The burpee zone', excerpt: 'Burpees must be completed within the designated burpee zone. Burpees completed outside of the zone will not count towards the burpee penalty.' },
  { id: 'OCR-2026-3.17.6', doc: R, section: '3.17.6', title: 'Every obstacle must be attempted', excerpt: 'All obstacles must be attempted. An attempt, at a minimum, is touching the obstacle.' },
  { id: 'OCR-2026-4.2', doc: R, section: '4.2', title: 'Single attempt (pass/fail) obstacles', excerpt: 'The section of single-attempt obstacles, each with its competitor instructions, failure modes and notes. The Spear Throw is 4.2.13.' },
  { id: 'OCR-2026-4.2.13', doc: R, section: '4.2.13', title: 'Spear Throw', excerpt: 'Both feet behind the barrier; throw at the target in the same lane; the spear must embed in the indicated target and stay there without touching the ground. Fail: not embedded, or touching the ground once stationary. An attempt once the spear is released in a forward motion. It may touch the ground before it is stationary in the target. Complete once 2 metres from the lane. Penalty: 30 burpees.' },
  ...OCR_RULES,
];

// where the 2026 sources disagree: open review items until the officiating lead rules for 2027
export const DISPUTES = [
  { rule: 'OCR-2026-3.4.2', title: 'Time penalty for missed burpees (Sprint, Super, Beast, Ultra)',
    detail: 'Rules 3.4.2: 30 seconds for each of the first 10 missed; more than 10 missed is 10 minutes in total. SOP 6.i: 30 seconds each; fewer than 20 completed is a 10-minute penalty. Online programme 6.3: 30 seconds each; 11 or more incorrect is 10 minutes; fewer than 20 completed is a disqualification.' },
  { rule: 'OCR-2026-3.4.2', title: 'Time penalty for missed burpees (Stadion)',
    detail: 'Rules 3.4.2a and 3.17.3: the penalty is 15 burpees; 30 seconds for each of the first 5 missed; more than 5 is 5 minutes. SOP 6.ii: 30 seconds per missed rep; fewer than 10 is 10 minutes. Not covered in the online programme.' },
  { rule: 'OCR-2026-3.17.3', title: 'Where burpees are the penalty',
    detail: 'Rules 3.17.3: a loop or 30 burpees, as Spartan designates per event; Stadion is always burpees. SOP 5.2.3: a loop for most obstacles; burpees at the Spear Throw. Online programme 5.4: burpees ONLY at the Spear Throw.' },
  { rule: 'OCR-2026-3.4.1', title: 'Skipping a penalty loop',
    detail: 'Rules 3.4.1: a 10-minute time penalty. SOP: not stated. Online programme 5.1: may result in disqualification.' },
  { rule: 'OCR-2026-4.2', title: 'Which obstacles are single attempt, multiple attempt or mandatory',
    detail: 'Rules 4.2 lists Monkey Bars, Multi-Rig, Twister, Olympus, Z Wall, Beater and Helix as single attempt; 4.1 lists Atlas Carry, Tire Flip and Stairway to Sparta as multiple attempt; 4.3 lists A-Frame Cargo as mandatory. The online programme lists the first group as multiple attempt (4.3), the second as mandatory (4.2), and says single attempt is "Spear Throw and rig-based obstacles" (4.4).' },
  { rule: 'OCR-2026-4.2.13', title: 'When a Spear Throw attempt starts',
    detail: 'Rules 4.2.13 c1: once the spear is released in a forward motion. Online programme 4.5: commitment starts when the spear is drawn back to throw.' },
  { rule: 'OCR-2026-4.2.13', title: 'A spear touching the ground in flight',
    detail: 'Rules 4.2.13 c4: it may touch the ground during the attempt, as long as it is not touching the ground once stationary in the target. Online programme 4.5: "spear touches ground before target" is a failure.' },
  ...OCR_DISPUTES,
];
