// The OCR Referee programme's lessons other than the Spear Throw (19 November 2026), written from Spartan's 2026 material (the
// rulebook, the Officiating SOP and the online programme's slides and notes) as content for the officiating lead to review: it follows
// the 2026 rulebook, and where the 2026 sources disagree a slide says "Under review for 2027" instead of settling it (RUL-04).
// The rule references the lessons cite, and any further disagreements found while writing them, are here too.
// Loaded by scripts/learn-seed.mjs through learn-lessons.mjs and learn-rules.mjs. The content itself is in learn-ocr-lessons.json.
import data from './learn-ocr-lessons.json' with { type: 'json' };

export const OCR_LESSONS = data.lessons;
export const OCR_RULES = data.rules;
export const OCR_DISPUTES = data.disputes;
