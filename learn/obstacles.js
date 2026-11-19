// Obstacles (#/obstacles): every obstacle type a referee may stand at, how it's done, and what's good (it counts) or bad (a fail).
// Short summaries in our own words of Spartan's 2026 Rules of Competition (Part 4, obstacle rules), taken from the Spartans app's
// Course Run (course-rules.js there) and checked against the rule references here (scripts/learn-ocr-lessons.json). Where a rule
// reference exists, the obstacle links to it. When Spartan updates the rules, update these too. Everyone signed in can see them.
import { $, esc, t } from './core.js';
import { videoHtml, wireVideos } from './video.js';

export const RULES_PAGE = 'https://spartanrace.zendesk.com/hc/en-us/articles/203602743-Official-Rules-Guidelines-and-Penalties-for-Spartan-Race-Obstacles';
export const RULEBOOK_PDF = 'https://d1lqw0hc39usuh.cloudfront.net/public/production/images/538372.pdf';

// how many tries: as many as they like, one, or it has to be done (rule 3.17.1: pass/fail and mandatory obstacles)
const TYPE = {
  multi: { label: 'Multiple attempts', text: 'Pass/fail. The athlete may try as many times as they like; if they give up, they take the penalty (burpees or a penalty loop, as the event sets).' },
  single: { label: 'One attempt', text: 'Pass/fail. One attempt: a fail means the penalty straight away (burpees or a penalty loop, as the event sets).' },
  must: { label: 'Mandatory', text: 'It has to be completed: there is no penalty to take instead. Failing a mandatory obstacle means disqualification, or a time penalty if the race director decides (rule 3.17.2).' },
};

// the kinds, in the order the list shows them, each with a small drawing
const S = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const GROUPS = [
  ['climb', 'Walls and climbs', S('<path d="M4 21V9h16v12M4 13h16M4 17h16M9 9v4M15 13v4M9 17v4"/><path d="M8 6l4-3 4 3"/>')],
  ['hang', 'Hanging and traverses', S('<path d="M2 4h20M6 4v5M12 4v3M18 4v5"/><circle cx="6" cy="11" r="2"/><circle cx="18" cy="11" r="2"/><path d="M12 7v13M9 20h6"/>')],
  ['carry', 'Carries, drags and lifts', S('<path d="M6 9h12l2 11H4L6 9z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/>')],
  ['ground', 'Crawls, jumps, water and balance', S('<path d="M2 8l3 2 3-2 3 2 3-2 3 2 3-2 2 1"/><path d="M3 19h18M6 19v-4h12v4"/>')],
  ['aim', 'Aim and memory', S('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>')],
  ['event', 'On the day', S('<path d="M6 17h12l-1.5-2V10a4.5 4.5 0 0 0-9 0v5L6 17z"/><path d="M10.5 20a1.5 1.5 0 0 0 3 0"/>')],
];

// the rulebook and the 2026 programme sort some obstacles differently (the lessons' review item says so too)
const REVIEW = 'Under review for 2027: the 2026 programme lists this as {type}. Until it’s settled, apply the rulebook (as here) and refer a disputed call to the Head Referee.';

/** id, title, kind, how many tries, its rulebook section (Part 4), how it's done, good (it counts), bad (a fail); optionally a note, the penalty,
 * the programme's differing type, a demonstration video (YouTube id; from the 2026 penalty obstacles videos) and a call to make (call) */
export const OBSTACLES = [
  { id: 'walls', title: 'Walls (6–10 ft)', group: 'climb', type: 'multi', section: '4.1.1',
    how: ['Climb up and over the wall, and come down the other side.'],
    good: ['Over the top and down, using the wall itself.', 'A woman using the red step.'],
    bad: ['Not getting over and down.', 'Using the support bracing, the sides of the wall, flag poles or straps.', 'A man using the red step: it’s for women only.'],
    note: 'Walls of 4 ft and 5 ft are mandatory, not pass/fail (rule 4.3.17).' },
  { id: 'inverted', title: 'Inverted Wall', group: 'climb', type: 'multi', section: '4.1.7',
    how: ['Up and over the overhanging wall, and down the far side.'],
    good: ['Over the top and down the far side.'],
    bad: ['Not getting over the wall and down the far side.', 'Touching the supports, the sides or straps.'] },
  { id: 'slip', title: 'Slip Wall', group: 'climb', type: 'multi', section: '4.1.9',
    how: ['Climb the sloping ramp, go over the top and come down.'],
    good: ['Using the ropes, and swapping from one rope to another.'],
    bad: ['Not getting up, over and down the other side.', 'Using the supports or the sides of the wall.'] },
  { id: 'stairway', title: 'Stairway to Sparta', group: 'climb', type: 'multi', section: '4.1.13', programme: 'must', video: 'LvV76-1eYIc',
    call: { q: 'An athlete uses the step to start the climb. Is that allowed?', options: ['Only for Open athletes.', 'Only for a smaller athlete.', 'Yes, for everyone.'], answer: 2, why: 'Anyone may use the step.' },
    how: ['Up and over the stepped wall, and down the other side.'],
    good: ['Anyone using the step.'],
    bad: ['Not getting over the wall.', 'Using the bracing, the sides or straps.'] },
  { id: 'bender', title: 'Bender', group: 'climb', type: 'multi', section: '4.1.4',
    how: ['Up and over the angled rungs, and down the other side.'],
    good: ['Feet on the rungs.'],
    bad: ['Not getting over and down the other side.', 'Using the structure, straps or flag poles.'] },
  { id: 'rope', title: 'Rope Climb', group: 'climb', type: 'multi', section: '4.1.8',
    how: ['Climb the rope and ring the bell.', 'Come back down under control, keeping at least one hand on the rope.'],
    good: ['The bell rung with any part of the body above the waist.', 'Changing to another rope after coming back to the ground.'],
    bad: ['Not ringing the bell.', 'Ringing it with the body below the waist.', 'Using more than one rope in a single attempt.', 'Coming down out of control, or without a hand on the rope.'] },
  { id: 'cargoplus', title: 'Vertical Cargo Plus', group: 'climb', type: 'multi', section: '4.1.15',
    how: ['Climb up from the shelf, over the top and down the other side.'],
    good: ['Using the webbing, the shelf, the horizontal bars at the base and the top, and horizontal pipes.'],
    bad: ['Not getting over the top.', 'Using the sides of the shelf.', 'Using any other supports.'] },
  { id: 'cargo', title: 'Vertical Cargo / A-Frame Cargo', group: 'climb', type: 'must', section: '4.3.24', programme: 'multi',
    how: ['Up the net, over the top and down the other side.'],
    good: ['Using the net, the horizontal bars at the base and the top, and horizontal pipes.'],
    bad: ['Not getting over and down the other side.', 'Using the side or middle uprights.'],
    note: 'The A-Frame Cargo is rule 4.3.18.' },
  { id: 'hurdles', title: 'Hurdles', group: 'climb', type: 'must', section: '4.3.39',
    how: ['Climb up and over every hurdle.'],
    good: ['Over every one of them.'],
    bad: ['Missing out a hurdle.', 'Using the supports, the sides or straps.'] },
  { id: 'out', title: 'O.U.T. / Over-Unders', group: 'climb', type: 'must', section: '4.3.22',
    how: ['O.U.T.: over the first wall, under the second, then through the window.', 'Over-Unders: over the walls with an up arrow, under the ones with a down arrow.'],
    good: ['Each wall taken the way it’s set.'],
    bad: ['Taking a wall the wrong way, over instead of under or the other way round.', 'Help from the support structure.'],
    note: 'Over-Unders is rule 4.3.36.' },

  { id: 'monkey', title: 'Monkey Bars', group: 'hang', type: 'single', section: '4.2.7', programme: 'multi',
    how: ['Cross from end to end on hands and arms only, then ring the bell.'],
    good: ['Using the horizontal truss to start or to change over.', 'The bell rung at the end.'],
    bad: ['Feet or legs touching the bars.', 'Feet touching the ground to gain an advantage.', 'Using the vertical truss as a ladder.', 'Going over the top of the bars.', 'Not ringing the bell.'] },
  { id: 'ape', title: 'Ape Hanger', group: 'hang', type: 'single', section: '4.2.2',
    how: ['Climb the rope or rope ladder, move onto the bars, cross on the hands only and ring the bell.'],
    good: ['Trying the climb up to the bars again: that part can be retried.', 'Using the horizontal truss in the middle.', 'The bell rung at the end.'],
    bad: ['Feet touching the bars.', 'Using the support structure or straps.', 'Going over the top.', 'Not ringing the bell.', 'Not finishing once a bar has been touched: from then on the athlete is committed.'] },
  { id: 'multirig', title: 'Multi-Rig', group: 'hang', type: 'single', section: '4.2.8', programme: 'multi', video: 'G1G441WUKfU',
    how: ['Cross the rings and handles on hands and arms only, in one lane, and ring the bell.'],
    good: ['Using the horizontal truss to start or to change over.', 'Staying in one lane all the way.', 'The bell rung at the end.'],
    bad: ['Grabbing the ropes, slings or chains that hold the rings and handles.', 'Feet on the attachments.', 'Using another lane.', 'Using the vertical truss as a ladder.', 'Feet touching the ground to gain an advantage.', 'Not ringing the bell.'],
    note: 'It counts as an attempt once both feet have left the starting step.' },
  { id: 'mitm', title: 'Monkey in the Middle', group: 'hang', type: 'single', section: '4.2.19', video: '5VZUAvPxZQg',
    how: ['Cross the handles (and the truss between them) on the hands, then the monkey bars on hands and arms, and ring the bell.'],
    good: ['Using the truss between the handles.', 'Using the horizontal truss to start.', 'The bell rung at the end.'],
    bad: ['Feet or legs touching the handles or bars, or going over the top.', 'Falling off.', 'Using the pipe the handles are fixed to.', 'Feet touching the ground to gain an advantage.', 'Using the vertical truss as a ladder.', 'Not ringing the bell.'],
    note: 'It counts as an attempt once both feet have left the starting step.' },
  { id: 'twister', title: 'Twister', group: 'hang', type: 'single', section: '4.2.15', programme: 'multi', video: 'suyCH7qyUX0',
    how: ['Cross using only the handles (and the truss between sections), and ring the bell.'],
    good: ['Using the truss between sections.', 'The bell rung at the end.'],
    bad: ['Falling off.', 'Feet on the handles.', 'Using the pipe the handles are fixed to.', 'Using the vertical truss as a ladder.', 'Not ringing the bell.'] },
  { id: 'hydra', title: 'Hydra', group: 'hang', type: 'single', section: '4.2.25',
    how: ['Cross on the attachments with hands and arms only, in one lane, and ring the bell.'],
    good: ['Staying in one lane all the way.', 'The bell rung at the end.'],
    bad: ['Falling off.', 'Grabbing the tubing that holds the attachments.', 'Feet on the attachments.', 'Going over the top.', 'Using another lane.', 'Not ringing the bell.'] },
  { id: 'helix', title: 'Helix', group: 'hang', type: 'single', section: '4.2.6', video: '2KC2HzEDYnM',
    how: ['Move sideways along the obstacle using only the bars in one lane, and ring the bell.'],
    good: ['Only that lane’s bars, all the way to the bell.', 'The bell rung at the end.'],
    bad: ['Touching the ground.', 'Touching the top.', 'Using bars from another lane.'],
    note: 'The athlete is committed once they have four points of contact.' },
  { id: 'olympus', title: 'Olympus', group: 'hang', type: 'single', section: '4.2.10', programme: 'multi', video: 'kog25l_YesY',
    call: { q: 'The athlete presses a knee against the flat wall, not a hold or a hole. What is your call?', options: ['Allowed: resting against the wall.', 'A fail.', 'They restart in a new lane.'], answer: 0, why: 'Feet and knees may rest against the wall; only feet or knees on or in the holds and holes are a fail.' },
    how: ['Move sideways along the angled wall, hands only on and in the holds and holes of one lane, and ring the bell.'],
    good: ['Feet and knees resting against the wall.', 'The bell rung at the end.'],
    bad: ['Touching the ground.', 'Touching the top of the wall.', 'Feet or knees on or in any of the holds or holes.'] },
  { id: 'zwall', title: 'Z Wall', group: 'hang', type: 'single', section: '4.2.17', programme: 'multi', video: '3mf7TsA3QzE',
    call: { q: 'The athlete has four points on the starting blocks, loses their position and steps down. What is your call?', options: ['Let them restart.', 'A failed attempt: the penalty.', 'Nothing until the bell.'], answer: 1, why: 'Four points of contact commits the athlete, so stepping down after that is a fail.' },
    how: ['Move sideways using only the hand and foot blocks (and the upright supports) in one lane, starting on the first blocks, and ring the bell.'],
    good: ['Using the upright supports.', 'The bell rung at the end.'],
    bad: ['Touching the ground.', 'Touching the top of the wall or any of the braces.', 'Touching the top or bottom of any cut-out.'],
    note: 'The athlete is committed once they have four points of contact.' },
  { id: 'hanging', title: 'Hanging Walls', group: 'hang', type: 'single', section: '4.2.24',
    how: ['Traverse the hanging panels on the red holds only, on one face, and ring the bell.'],
    good: ['Red holds only, on one face, all the way to the bell.', 'The vertical truss to get started.', 'The bell rung at the end.'],
    bad: ['Feet on the ground after starting.', 'Using holds that aren’t red, or the other face.', 'Using any other truss.', 'Grabbing the ropes, slings or chains that hold the panels.', 'Not ringing the bell.'],
    note: 'The athlete is committed once both feet leave the starting bar or step.' },
  { id: 'tilting', title: 'Tilting Ladder', group: 'hang', type: 'single', section: '4.2.14',
    how: ['Cross on hands and arms only, and ring the bell.'],
    good: ['Using the monkey bar between the ladders.', 'Using the horizontal truss to start.', 'The bell rung at the end.'],
    bad: ['Feet on the bars.', 'Using the uprights as a ladder.', 'Feet touching the ground to gain an advantage.'] },
  { id: 'tyrolean', title: 'Tyrolean Traverse', group: 'hang', type: 'single', section: '4.2.16', video: '15e1cNVi-nQ',
    how: ['Get on the rope at the start, travel along it, and ring the bell with the hands.'],
    good: ['Getting off once the bell is rung.'],
    bad: ['Using the ground or the water below to help.', 'Not ringing the bell with the hands.', 'Getting on the rope too far from the start.'],
    note: 'After a fail, the athlete carries on through the ground or water below, staying in their lane.' },

  { id: 'hoist', title: 'Hercules Hoist', group: 'carry', type: 'multi', section: '4.1.6',
    how: ['Pull the rope until the knot touches the pulley at the top.', 'Lower the weight under control, and let go only once it’s on the ground.'],
    good: ['The knot touching the pulley.', 'The weight under control, not falling, when it touches the ground.', 'Feet pushing against the barrier.'],
    bad: ['Dropping the weight to the ground out of control, for any reason.', 'Standing on or climbing over the barrier.', 'Hips rising above the top of the barrier.', 'No part of the body on the ground while touching the barrier.', 'Tying off the rope, or any help other than feet on the barrier.'] },
  { id: 'atlas', title: 'Atlas Carry', group: 'carry', type: 'multi', section: '4.1.3', programme: 'must',
    how: ['Pick up the stone, carry it past the far flags, turn, and set it back down at the start.'],
    good: ['Putting the stone down to rest.', 'If it moves, picking it up again from exactly the spot where it stopped.'],
    bad: ['Not carrying it past the far flags, or not returning it to the start.', 'Rolling the stone.', 'Carrying on from anywhere but where it came to rest.'] },
  { id: 'tireflip', title: 'Tire Flip', group: 'carry', type: 'multi', section: '4.1.14', video: '2lpCYmQso3M',
    call: { q: 'The tyre drops before the athlete has completed one full flip. Is that a fail?', options: ['Yes, always.', 'No: they may try again.', 'Only if it makes a noise.'], answer: 1, why: 'They aren’t committed to the tyre until one full flip, and dropping it by accident or from tiredness isn’t a fail.' },
    how: ['Flip the tyre over once and let it come to rest on the ground.', 'Let go of it completely, hands and feet, then flip it back over to where it started.'],
    good: ['Changing tyres and trying again, before the first full flip.', 'Dropping the tyre by accident or from tiredness: it isn’t a fail.'],
    bad: ['Not flipping it twice.', 'Touching it before it has come to rest after the first flip.', 'Not getting it back to where it started.', 'Standing inside the tyre to flip it.'],
    note: 'The athlete is committed to a tyre once they have completed one full flip.' },
  { id: 'sandbag', title: 'Sandbag Carry', group: 'carry', type: 'must', section: '4.3.8',
    how: ['Carry the bag round the whole marked course, and return it.'],
    good: ['Putting it down to rest, then setting off again from wherever it landed.'],
    bad: ['Dragging, rolling, throwing or pushing the bag.', 'Setting off again from anywhere but where it landed.', 'Carrying the wrong bag or the wrong number of bags.', 'Moving on with only one of several bags: they’re carried together.'] },
  { id: 'bucket', title: 'Bucket Carry', group: 'carry', type: 'must', section: '4.3.3',
    how: ['Carry the bucket along the marked course with the lid on, and return it.'],
    good: ['Resting the bucket on the ground.', 'Putting back a lid knocked off by accident, if nothing spilled.', 'Coming back with as much in it as at the start.'],
    bad: ['Coming back with material missing: the whole course is done again with a properly filled bucket.', 'Cutting any part of the course.', 'Carrying a bucket for the other gender.'],
    note: 'There is no burpee option: it has to be done.' },
  { id: 'log', title: 'Log Carry', group: 'carry', type: 'must', section: '4.3.7',
    how: ['Carry the log round the whole marked course, and return it.'],
    good: ['Putting it down to rest; if it moves, bringing it back to where it was put down before carrying on.'],
    bad: ['Dragging, rolling, throwing or pushing the log.', 'Carrying the wrong log.', 'Setting off again from anywhere but where it was put down.'] },
  { id: 'chain', title: 'Chain Carry', group: 'carry', type: 'must', section: '4.3.10',
    how: ['Carry the chain round the whole marked course, and return it.'],
    good: ['Putting it down to rest, then setting off again from where it was put down.'],
    bad: ['Dragging, rolling, throwing or pushing the chain.', 'Carrying the wrong chain or the wrong number of chains.'] },
  { id: 'armer', title: 'Armer', group: 'carry', type: 'must', section: '4.3.1',
    how: ['Carry the weight by its handles round the whole marked course, and return it.'],
    good: ['Putting it down to rest; if it moves, bringing it back to that spot before carrying on.'],
    bad: ['Dragging, rolling, throwing or pushing the weight.', 'Not carrying it by the handles.', 'Carrying the wrong weight.'] },
  { id: 'drag', title: 'Plate / Tire Drag', group: 'carry', type: 'must', section: '4.3.40',
    how: ['Pull the plate or tyre to the stake with the rope, keeping the torso behind the stake.', 'Then drag it back to where it started, with the rope pulled tight.'],
    good: ['The load on the ground the whole time.', 'Freeing a stuck load, as long as it isn’t moved forward while doing so.'],
    bad: ['Lifting, carrying or rolling it.', 'The torso going past the stake (a foot or leg slipping past is fine).', 'Not bringing it back with the rope pulled tight.', 'Taking the rope off the stake.'] },

  { id: 'crawl', title: 'Barbed Wire / Net Crawl', group: 'ground', type: 'must', section: '4.3.2',
    how: ['Go under the wire or net from one end to the other.'],
    good: ['Rolling.', 'Touching the wire or the net.'],
    bad: ['Not going under it the whole way, end to end.'] },
  { id: 'fire', title: 'Fire Jump', group: 'ground', type: 'must', section: '4.3.20',
    how: ['Jump over the fire.'],
    good: ['Over the fire.', 'Going back to jump it after crowds forced the athlete round.'],
    bad: ['Going round the fire.'] },
  { id: 'swim', title: 'Swim / Water Crossing', group: 'ground', type: 'must', section: '4.3.9',
    how: ['Go through the water from one end to the other, staying inside the marked course.'],
    good: ['Inside the marked course the whole way.'],
    bad: ['Leaving the boundaries, or skirting round the obstacle.', 'Diving.'] },
  { id: 'balance', title: 'Balance Beam', group: 'ground', type: 'single', section: '4.2.4',
    how: ['Walk along one beam on the feet only, without touching the ground.'],
    good: ['Touching the last (descending) beam before getting off, and landing past the line.'],
    bad: ['Touching the ground, or using anything but the feet.', 'Touching another beam after starting on one.', 'Getting off before the last beam, or landing short of the line.'],
    note: 'Two feet on the beam counts as the attempt.' },
  { id: 'slackline', title: 'Slackline', group: 'ground', type: 'single', section: '4.2.18',
    how: ['Cross one slackline on the feet only.'],
    good: ['Stepping down beyond the finish line.'],
    bad: ['Stepping down before the finish line.', 'Using anything but the feet.', 'Touching another slackline after starting on one.'],
    note: 'Two feet on the line counts as the attempt.' },

  { id: 'spear', title: 'Spear Throw', group: 'aim', type: 'single', section: '4.2.13', penalty: '30 burpees',
    how: ['With both feet behind the barrier, throw the spear at the target in the athlete’s own lane.'],
    good: ['The spear sticks in the target and stays there, not touching the ground.', 'Changing lanes before throwing.'],
    bad: ['A foot over the barrier.', 'A miss, or the spear falling out or touching the ground.'],
    note: 'It only counts once the athlete has moved at least 2 m away from the lane: if the spear falls out before then, it’s a fail. Releasing the spear forwards is the attempt.' },
  { id: 'laser', title: 'Laser Pistol', group: 'aim', type: 'single', section: '4.2.27', penalty: 'The penalty loop',
    how: ['Stand inside the shooting area, 1 m behind the table, with both feet on the ground and not leaning on anything, and shoot at the athlete’s own numbered target.'],
    good: ['3 hits on the black centre within 20 seconds (the time starts at the first hit).'],
    bad: ['Fewer than 3 hits on the black centre in the 20 seconds.', 'Shooting from outside the shooting area, or at another target.'] },
  { id: 'memory', title: 'Memory Test', group: 'aim', type: 'single', section: '4.2.20',
    how: ['Find the last two digits of the headband number on the board, and memorise the words or symbols next to them.', 'Say them back when an official asks later in the race.'],
    good: ['Said back exactly.'],
    bad: ['Anything wrong or missing.', 'Writing it down.'] },

  { id: 'iconic', title: 'Iconic Obstacle', group: 'event', type: 'must',
    how: ['Complete the obstacle as the course officials brief it on the day.'],
    good: ['Done as briefed.'],
    bad: ['Not done as briefed.'],
    note: 'This one is specific to the event: the briefing on the day sets its rules.' },
];

// what holds at every obstacle, with the rule each comes from
const GENERAL = [
  ['Bells are struck with the arms and hands, or any part of the body above the chest. Kicking a bell (feet, legs or knees) is a fail: no retry, the penalty.', 'OCR-2026-3.17.7'],
  ['An athlete who fails because another competitor got in their way may start the obstacle again, with no penalty, once an official allows it.', 'OCR-2026-3.17.8'],
  ['Where there are separate men’s and women’s options, athletes do the one for their registered category. A woman may choose not to use a step or kicker meant for women.', 'OCR-2026-3.17.9'],
  ['Failing a mandatory obstacle means disqualification, or a time penalty if the race director decides.', 'OCR-2026-3.17.2'],
];

const ruleLink = (id) => `<a href="#/rules/${encodeURIComponent(id)}">${esc(t('Rule {n}', { n: id.replace(/^OCR-\d{4}-/, '') }))}</a>`;
// the obstacle rules the site has as rule references (scripts/learn-ocr-lessons.json); the others show their section without a link
export const LINKED = ['4.1.1', '4.1.6', '4.1.8', '4.2.2', '4.2.6', '4.2.7', '4.2.8', '4.2.10', '4.2.17', '4.3.3', '4.3.9'];
const sectionText = (s) => (LINKED.includes(s) ? ruleLink(`OCR-2026-${s}`) : esc(t('Rule {n}', { n: s })));
const typeChip = (type) => `<span class="obType ${type}">${esc(t(TYPE[type].label))}</span>`;
const icon = (g) => GROUPS.find(([k]) => k === g)[2];
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const sources = () => `<p class="note">${esc(t('Short summaries in our own words of Spartan’s 2026 Rules of Competition. Where they differ, the official text wins:'))}
  <a href="${RULES_PAGE}" target="_blank" rel="noopener">${esc(t('Spartan’s obstacle rules'))}</a> · <a href="${RULEBOOK_PDF}" target="_blank" rel="noopener">${esc(t('the rulebook as a PDF'))}</a></p>`;

function listView() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const want = TYPE[q.get('type')] ? q.get('type') : '';
  // searched in English and in the words on screen, so a referee reading in French finds "corde" too
  const row = (o) => `<li data-q="${esc(fold([o.title, t(o.title), ...o.how, ...o.how.map((x) => t(x)), t(TYPE[o.type].label)].join(' ')))}" data-type="${o.type}">
    <a href="#/obstacles/${o.id}"><span class="obIcon">${icon(o.group)}</span><span class="obName"><b>${esc(t(o.title))}</b><small>${esc(t(o.how[0]))}</small></span>${typeChip(o.type)}</a></li>`;
  return `<section class="card"><h1>Obstacles</h1>
      <p class="note">Every kind of obstacle you may referee: how it’s done, what counts, and what’s a fail. Tap one for the detail.</p>
      <div class="ruleSearch obSearch"><input type="search" id="obQ" value="${esc(q.get('q') || '')}" placeholder="Search obstacles" aria-label="Search the obstacles" aria-controls="obList" autocomplete="off" enterkeyhint="search"><span class="muted" id="obCount" aria-live="polite"></span></div>
      <div class="obFilter" role="group" aria-label="${esc(t('How many tries'))}">${[['', 'All'], ...Object.entries(TYPE).map(([k, v]) => [k, v.label])].map(([k, l]) => `<button type="button" class="small${k === want ? ' on' : ''}" data-ob-type="${k}" aria-pressed="${k === want}">${esc(t(l))}</button>`).join('')}</div>
      <div id="obList">${GROUPS.map(([g, name]) => `<div class="obGroup" data-group="${g}"><h2>${esc(t(name))}</h2><ul class="rowList obList">${OBSTACLES.filter((o) => o.group === g).map(row).join('')}</ul></div>`).join('')}</div>
      <p class="muted" id="obNone" hidden>No obstacle matches that. Try fewer words.</p></section>
    <section class="card"><h2>At every obstacle</h2><ul class="obGeneral">${GENERAL.map(([s, r]) => `<li><span>${esc(t(s))}</span> <small>${ruleLink(r)}</small></li>`).join('')}</ul>
      <p class="note">${esc(t('Pass/fail obstacles allow either as many attempts as the athlete likes, or one. The penalty for a fail is burpees or a penalty loop, as the event sets.'))}</p>${sources()}</section>`;
}

function obstacleView(id) {
  const k = OBSTACLES.findIndex((o) => o.id === id);
  if (k < 0) return listView();
  const o = OBSTACLES[k], prev = OBSTACLES[k - 1], next = OBSTACLES[k + 1];
  const list = (items, cls) => `<ul class="obMarks ${cls}">${items.map((x) => `<li>${esc(t(x))}</li>`).join('')}</ul>`;
  return `<section class="card" id="obPage"><p class="crumbs"><a href="#/obstacles">Obstacles</a></p>
      <div class="obHead"><span class="obIcon big">${icon(o.group)}</span><div><h1>${esc(t(o.title))}</h1><p class="obMeta">${typeChip(o.type)} <span class="muted">${esc(t(GROUPS.find(([g]) => g === o.group)[1]))}</span></p></div></div></section>
    <div id="obAnimSlot" data-id="${esc(o.id)}" data-title="${esc(o.title)}"></div>
    ${o.video ? `<section class="card obVideo"><h2>Watch it</h2>${videoHtml(o.video, o.title)}<p class="note">${esc(t('A demonstration of the obstacle, with captions in your language where YouTube can translate them. The rulebook always takes precedence over a video.'))}</p></section>` : ''}
    ${o.call ? `<section class="card obCall" id="obCall"><h2>Make the call</h2><p>${esc(t(o.call.q))}</p><div class="obCallOptions">${o.call.options.map((x, i) => `<button type="button" class="obCallBtn" data-i="${i}">${esc(t(x))}</button>`).join('')}</div><p class="obCallWhy" hidden></p></section>` : ''}
    <section class="card"><p>${esc(t(TYPE[o.type].text))}</p>
      ${o.penalty ? `<p><b>${esc(t('Penalty for a fail:'))}</b> ${esc(t(o.penalty))}</p>` : ''}
      ${o.note ? `<p class="obNote">${esc(t(o.note))}</p>` : ''}
      ${o.programme ? `<p class="obReview">${esc(t(REVIEW, { type: t(TYPE[o.programme].label) }))}</p>` : ''}
      <h2>How it’s done</h2><ol class="obHow">${o.how.map((x) => `<li>${esc(t(x))}</li>`).join('')}</ol></section>
    <div class="obVerdicts">
      <section class="card obGood"><h2><span aria-hidden="true">✓</span> Good: it counts</h2>${list(o.good, 'good')}</section>
      <section class="card obBad"><h2><span aria-hidden="true">✗</span> Bad: it’s a fail</h2>${list(o.bad, 'bad')}</section>
    </div>
    <section class="card">${o.section ? `<p>${esc(t('In the rulebook:'))} ${sectionText(o.section)}</p>` : ''}${sources()}
      <nav class="obPager" aria-label="${esc(t('Other obstacles'))}">${prev ? `<a class="btnLink" href="#/obstacles/${prev.id}"><span aria-hidden="true">‹</span> ${esc(t(prev.title))}</a>` : '<span></span>'}${next ? `<a class="btnLink" href="#/obstacles/${next.id}">${esc(t(next.title))} <span aria-hidden="true">›</span></a>` : ''}</nav></section>`;
}

/** shows the obstacles with every word typed and of the kind of tries picked, as you type; kept in the address for coming back */
function filter() {
  const input = $('obQ'); if (!input) return;
  const words = fold(input.value).split(/\s+/).filter(Boolean);
  const want = document.querySelector('[data-ob-type].on')?.dataset.obType || '';
  const items = [...document.querySelectorAll('#obList li[data-q]')];
  let shown = 0;
  for (const li of items) { const hit = (!want || li.dataset.type === want) && words.every((w) => li.dataset.q.includes(w)); li.hidden = !hit; if (hit) shown++; }
  for (const g of document.querySelectorAll('.obGroup')) g.hidden = !g.querySelector('li:not([hidden])');
  $('obCount').textContent = shown === items.length ? t('{n} obstacles', { n: items.length }) : t('{shown} of {total}', { shown, total: items.length });
  $('obNone').hidden = !!shown;
  const [path, qs = ''] = location.hash.split('?'), p = new URLSearchParams(qs);
  if (input.value.trim()) p.set('q', input.value.trim()); else p.delete('q');
  if (want) p.set('type', want); else p.delete('type');
  history.replaceState(null, '', `${path}${p.toString() ? `?${p}` : ''}`);
}

export function wire() {
  // an obstacle opens at its top, also from Previous / Next at the bottom of the one before
  if ($('obPage')) {
    scrollTo(0, 0);
    wireVideos($('view'));
    // make the call: tap an answer, see whether it's right and why
    const call = $('obCall');
    if (call) {
      const o = OBSTACLES.find((x) => x.id === $('obAnimSlot').dataset.id);
      for (const b of call.querySelectorAll('.obCallBtn')) b.addEventListener('click', () => {
        const right = +b.dataset.i === o.call.answer;
        for (const x of call.querySelectorAll('.obCallBtn')) { x.classList.toggle('right', +x.dataset.i === o.call.answer); x.classList.toggle('wrong', x === b && !right); x.disabled = true; }
        const why = call.querySelector('.obCallWhy');
        why.textContent = `${right ? t('Right.') : t('Not quite.')} ${t(o.call.why)}`; why.hidden = false;
      });
    }
    // its animation, loaded only on an obstacle's page (obstacle-scenes.js); an obstacle without one just has no player
    const slot = $('obAnimSlot');
    if (slot) Promise.all([import('./obstacle-anim.js'), import('./obstacle-scenes.js')]).then(([A, S]) => {
      const make = S.SCENES[slot.dataset.id];
      if (!make || !slot.isConnected) return;
      slot.innerHTML = A.playerHtml(slot.dataset.title);
      A.play(slot.querySelector('.obAnim'), make());
    }).catch(() => { /* the page still works without it */ });
    return;
  }
  if (!$('obQ')) return;
  $('obQ').addEventListener('input', filter);
  for (const b of document.querySelectorAll('[data-ob-type]')) b.addEventListener('click', () => {
    for (const x of document.querySelectorAll('[data-ob-type]')) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }
    filter();
  });
  filter();
}

export const views = { obstacles: async (rest) => (rest ? obstacleView(rest) : listView()) };
