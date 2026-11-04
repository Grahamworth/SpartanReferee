// What a referee checks at each obstacle: short summaries, in our own words, of Spartan's 2026 Rules of Competition
// (Part D, obstacle rules; rulebook updated April 2026). The official text is linked from every summary.
export const RULES_PAGE = 'https://spartanrace.zendesk.com/hc/en-us/articles/203602743-Official-Rules-Guidelines-and-Penalties-for-Spartan-Race-Obstacles';
export const RULEBOOK_PDF = 'https://d1lqw0hc39usuh.cloudfront.net/public/production/images/538372.pdf';

// type: 'multi' = as many attempts as you like (pass/fail); 'single' = one attempt, then the penalty; 'must' = mandatory, no penalty option
const R = {
  wall: { title: 'Walls (6–10 ft)', type: 'multi', points: ['Get up and over, and down the other side.', 'No help from the bracing, the sides of the wall, flag poles or straps.', 'The red step is for women only.'] },
  inverted: { title: 'Inverted Wall', type: 'multi', points: ['Up and over the overhanging wall and down the far side.', 'Don’t touch the supports, the sides or straps.'] },
  slip: { title: 'Slip Wall', type: 'multi', points: ['Climb the sloping ramp (using the ropes is fine, and you can swap ropes), over the top and down.', 'No using the supports or the sides of the wall.'] },
  stairway: { title: 'Stairway to Sparta', type: 'multi', points: ['Up and over the stepped wall without the bracing, sides or straps.', 'Anyone may use the step.'] },
  bender: { title: 'Bender', type: 'multi', points: ['Up and over the angled rungs and down the other side.', 'Feet on the rungs are allowed; the structure, straps and flag poles are not.'] },
  rope: { title: 'Rope Climb', type: 'multi', points: ['Climb the rope and ring the bell with any part of you above the waist.', 'One rope per attempt; you may switch ropes after coming back to the ground.', 'Come down under control, keeping at least one hand on the rope.'] },
  cargo: { title: 'Vertical Cargo / A-Frame Cargo', type: 'must', points: ['Up, over the top and down the other side.', 'Use only the net, the horizontal bars at the base and the top, and horizontal pipes.', 'The side and middle uprights are off limits.'] },
  hoist: { title: 'Hercules Hoist', type: 'multi', points: ['Pull the rope until the knot touches the pulley at the top.', 'Lower the weight under control and only let go once it’s on the ground: no letting it drop.', 'Feet may push on the barrier, but never stand on it, climb over it, or let your hips rise above its top.'] },
  atlas: { title: 'Atlas Carry', type: 'multi', points: ['Pick up the stone, carry it past the far flags, turn and set it back down at the start.', 'You can put it down, but never roll it; if it moves, pick it up again from exactly that spot.'] },
  sandbag: { title: 'Sandbag Carry', type: 'must', points: ['Carry the bag round the whole marked course and return it.', 'No dragging, rolling, throwing or pushing it.', 'Put it down if you need to, but restart from wherever it landed.'] },
  bucket: { title: 'Bucket Carry', type: 'must', points: ['Carry the bucket round the marked course with the lid on.', 'It must come back with as much in it as it started with, or you go round again.', 'There is no burpee option: it has to be done. Resting it on the ground is fine.'] },
  log: { title: 'Log Carry', type: 'must', points: ['Carry the log round the whole marked course and return it.', 'No dragging, rolling, throwing or pushing.', 'If you put it down and it moves, carry on from where it ended up.'] },
  chain: { title: 'Chain Carry', type: 'must', points: ['Carry the chain round the whole marked course and return it.', 'No dragging, rolling, throwing or pushing it.'] },
  drag: { title: 'Plate / Tire Drag', type: 'must', points: ['Pull the plate or tyre to the stake with the rope, keeping your body behind the stake.', 'Then drag it back to its start with the rope pulled tight.', 'Never lift or carry it: it must stay on the ground.'] },
  armer: { title: 'Armer', type: 'must', points: ['Carry the weight by its handles round the whole marked course and return it.', 'No dragging, rolling, throwing or pushing.'] },
  crawl: { title: 'Barbed Wire / Net Crawl', type: 'must', points: ['Get under it from one end to the other.', 'Rolling is allowed, and touching the wire or net is fine.'] },
  balance: { title: 'Balance Beam', type: 'single', points: ['Walk along one beam on your feet only, without touching the ground.', 'Touch the last (descending) beam before you dismount, and land past the line.', 'Two feet on the beam counts as your attempt.'] },
  slackline: { title: 'Slackline', type: 'single', points: ['Cross one slackline on your feet only.', 'Step down only beyond the finish line.'] },
  monkey: { title: 'Monkey Bars', type: 'single', points: ['Cross from end to end on your hands and arms only, then ring the bell.', 'No feet or legs on the bars, no going over the top, no using the uprights as a ladder.'] },
  ape: { title: 'Ape Hanger', type: 'single', points: ['Climb the rope or ladder to the bars (that part can be retried), then cross under the bars on your hands and ring the bell.', 'Feet may not touch the bars. Once you’ve touched a bar you’re committed.'] },
  multirig: { title: 'Multi-Rig', type: 'single', points: ['Cross the rings and handles on hands and arms only, in one lane, and ring the bell.', 'No grabbing the ropes, slings or chains that hold them, and no feet on the attachments.'] },
  twister: { title: 'Twister', type: 'single', points: ['Cross using only the handles (and the truss between sections) and ring the bell.', 'Falling off is a fail. No feet on the handles.'] },
  hydra: { title: 'Hydra', type: 'single', points: ['Cross on the attachments with hands and arms only, in one lane, and ring the bell.', 'No grabbing the tubing that holds them, no feet on them, no going over the top.'] },
  tyrolean: { title: 'Tyrolean Traverse', type: 'single', points: ['Get on the rope at the start and travel along it, then ring the bell with your hands.', 'Using the ground or water below to help is a fail. Get off after the bell.'] },
  olympus: { title: 'Olympus', type: 'single', points: ['Move sideways along the angled wall using only the holds, holes and chains in your lane, then ring the bell.', 'Don’t touch the ground or the top of the wall. Feet may press on the wall, but not in the holds.'] },
  zwall: { title: 'Z Wall', type: 'single', points: ['Traverse sideways using only the hand and foot blocks (start on the first ones), then ring the bell.', 'Touching the ground, the top, the braces or the cut-out edges is a fail.'] },
  hanging: { title: 'Hanging Walls', type: 'single', points: ['Traverse the hanging panels on the red holds only, on one face, and ring the bell.', 'Feet on the ground after starting is a fail.'] },
  spear: { title: 'Spear Throw', type: 'single', points: ['Both feet behind the barrier; throw at the target in your lane.', 'The spear must stick in the target and stay there without touching the ground.', 'Fail: 30 burpees.'] },
  laser: { title: 'Laser Pistol', type: 'single', points: ['Stand inside the shooting area behind your table.', 'Hit the black centre of your own target 3 times within 20 seconds (the timer starts at your first hit).', 'Fail: the penalty loop.'] },
  tilting: { title: 'Tilting Ladder', type: 'single', points: ['Cross on hands and arms only and ring the bell.', 'No feet on the bars, no using the uprights as a ladder.'] },
  memory: { title: 'Memory Test', type: 'single', points: ['Find the last two digits of your headband on the board and memorise the words or symbols next to them.', 'Say them back exactly when an official asks you later on.', 'Writing it down is not allowed.'] },
  hurdles: { title: 'Hurdles', type: 'must', points: ['Climb up and over every hurdle.', 'No using the supports, sides or straps.'] },
  fire: { title: 'Fire Jump', type: 'must', points: ['Jump over the fire. Going round it is a fail (you can go back and do it if crowds forced you round).'] },
  out: { title: 'O.U.T. / Over-Unders', type: 'must', points: ['Over the walls marked for over, under the ones marked for under, and through the window.', 'No help from the support structure.'] },
  net: { title: 'Cargo Net Climb', type: 'must', points: ['Climb up, over and down using only the net and the horizontal bars and pipes.'] },
  bell: { title: 'Iconic Obstacle', type: 'must', points: ['Complete the obstacle as the course officials brief it on the day (this one is specific to the event).'] },
};

/** The summary for an obstacle (by its name in the route file). */
export function rulesFor(name) {
  const n = name.toUpperCase();
  const k = /ROPE/.test(n) ? 'rope' : /INVERTED/.test(n) ? 'inverted' : /SLIP/.test(n) ? 'slip' : /STAIRWAY/.test(n) ? 'stairway' : /BENDER/.test(n) ? 'bender'
    : /HERCULE|HOIST|\bHH\b/.test(n) ? 'hoist' : /ATLAS/.test(n) ? 'atlas' : /SANDBAG/.test(n) ? 'sandbag' : /BUCKET/.test(n) ? 'bucket' : /LOG/.test(n) ? 'log'
    : /CHAIN/.test(n) ? 'chain' : /PLATE|TIRE DRAG|DRAG/.test(n) ? 'drag' : /ARMER/.test(n) ? 'armer' : /BARB|CRAWL/.test(n) ? 'crawl'
    : /SLACK/.test(n) ? 'slackline' : /BALANCE/.test(n) ? 'balance' : /MONKEY/.test(n) ? 'monkey' : /APE/.test(n) ? 'ape' : /MULTIRING|MULTI/.test(n) ? 'multirig'
    : /TWISTER/.test(n) ? 'twister' : /HYDRA/.test(n) ? 'hydra' : /TYROLEAN/.test(n) ? 'tyrolean' : /OLYMPUS/.test(n) ? 'olympus' : /Z WALL/.test(n) ? 'zwall'
    : /HANGING/.test(n) ? 'hanging' : /SPEAR/.test(n) ? 'spear' : /LASER/.test(n) ? 'laser' : /TILTING/.test(n) ? 'tilting' : /MEMORY/.test(n) ? 'memory'
    : /HURDLE/.test(n) ? 'hurdles' : /FIRE/.test(n) ? 'fire' : /OUOU|\bOUT\b/.test(n) ? 'out' : /CARGO|A FRAME/.test(n) ? 'cargo' : /NET/.test(n) ? 'net'
    : /BELL|ICONIC/.test(n) ? 'bell' : /WALL/.test(n) ? 'wall' : null;
  return k ? R[k] : null;
}
export const TYPE_TEXT = { multi: 'Pass/fail, as many attempts as you like', single: 'Pass/fail, one attempt – then the penalty', must: 'Mandatory: it has to be completed' };
