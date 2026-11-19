// Animations on the existing lessons' slides (19 November 2026): which slide (by its English heading) shows which animation instead of its
// drawing. scripts/learn-seed.mjs puts them on each lesson's published English content (the translations show the English slide's visual).
// The animations are learn/obstacle-scenes.js: an obstacle's good run and fails, or a movement (the burpee standard).
export const VISUALS = {
  'ocr-1-2': { 'Trail running with obstacles': 'walls' },
  'ocr-4-1': { 'Mandatory obstacles': 'sandbag', 'Multiple attempt obstacles': 'rope', 'Single attempt obstacles: when commitment starts': 'multirig' },
  'ocr-4-2': { 'A single-attempt obstacle': 'spear', 'Pass or fail': 'spear' },
  'ocr-5-1': { 'Burpee deficits': 'burpee' },
  'ocr-5-2': { 'Bells and interference': 'monkey' },
  'ocr-5-3': { 'Where burpees are the penalty': 'burpee' },
  'ocr-6-1': { 'One complete burpee': 'burpee', 'One continuous movement': 'burpee' },
  'ocr-6-2': { 'Watching the standard': 'burpee', 'Asking for extra burpees': 'burpee' },
  'ocr-6-3': { 'What counts as a missed burpee': 'burpee' },
  'ocr-9-1': { 'Watch the hands and feet': 'olympus' },
  'ocr-9-2': { 'Using the support structure': 'walls', "Burpees that don't meet the standard": 'burpee', 'The bell': 'rope' },
  'ocr-9-3': { 'Scenario 1: a brief touch on the top': 'zwall', 'Scenario 2: fast burpees, hips not extended': 'burpee' },
  'cam-3-1': { 'What it checks on a burpee': 'burpee' },
};
