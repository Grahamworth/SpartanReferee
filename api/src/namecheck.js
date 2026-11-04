/* Rude or offensive names: one check shared by the app (loaded as a plain script) and the API (require).
   This is the original: scripts/sync-web.mjs copies it to api/src/namecheck.js (edit this one), so a name is refused the same way on the phone and on the server.
   The name is lower-cased, accents dropped, look-alike digits and symbols read as letters (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s),
   and doubled-up letters squeezed ("fuuuck"). Words in STRONG are refused anywhere in the name, even run together or spaced out;
   words in WHOLE only as a word of their own, so ordinary names that happen to contain them (Hancock, Dickens, Cassie) are fine. */
'use strict';
const NAME_STRONG = ['fuck', 'fuk', 'fck', 'shit', 'cunt', 'wank', 'bollock', 'twat', 'nigger', 'nigga', 'faggot', 'whore', 'slut', 'bitch', 'bastard',
  'dickhead', 'motherf', 'retard', 'nazi', 'hitler', 'rapist', 'paedo', 'pedo', 'porn', 'dildo', 'jizz', 'bellend', 'tosser', 'pussy', 'spastic', 'kkk'];
const NAME_WHOLE = ['ass', 'arse', 'arsehole', 'asshole', 'cock', 'dick', 'prick', 'piss', 'tit', 'tits', 'knob', 'nob', 'crap', 'rape', 'paki', 'spaz', 'kike',
  'chink', 'coon', 'gook', 'wop', 'dyke', 'tranny', 'homo', 'cum', 'boob', 'boobs', 'penis', 'vagina', 'anus', 'minge', 'shag', 'bugger', 'fag', 'fags', 'sex',
  'nonce', 'slag', 'skank', 'lesbo', 'wog', 'jap', 'gyppo', 'pikey', 'bum', 'butt', 'poo', 'poop', 'turd', 'sod', 'git', 'nut', 'nuts', 'balls'];
const NAME_FINE = ['scunthorpe', 'penistone', 'cockburn', 'hancock', 'peacock', 'shitake', 'shiitake', 'essex', 'sussex', 'middlesex', 'assassin', 'classic', 'cassandra',
  'matsushita', 'pushkin', 'butters', 'buttermere', 'arsenal', 'dickens', 'twatt'];
const LEET = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b', '9': 'g' };
const squeeze = s => s.replace(/(.)\1+/g, '$1');
/** words fine in a message that would be silly as a name ("my legs are nuts", "snow balls") */
const TEXT_OK = ['nut', 'nuts', 'balls', 'bum', 'butt', 'poo', 'poop', 'sod', 'git', 'crap', 'sex', 'shag', 'tit', 'tits', 'knob', 'nob', 'cum', 'anus', 'boob', 'boobs', 'penis', 'vagina'];
/** true when the name holds a rude or offensive word */
function rudeName(name, ok) {
  let s = String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[0-9!|@$+]/g, c => LEET[c] || c);
  const words = s.split(/[^a-z]+/).filter(Boolean);
  const spaced = (' ' + words.join(' ') + ' ').match(/(?: [a-z](?= ))+/g) || [];   // single letters spaced out ("a s s"): read them as one word
  const bad = w => NAME_WHOLE.includes(w) && !(ok && ok.includes(w));
  for (const w of [...words, ...spaced.map(r => r.replace(/ /g, ''))]) if (bad(w) || bad(squeeze(w))) return true;
  let joined = words.join(''); for (const f of NAME_FINE) joined = joined.split(f).join(' ');   // place names and words that only look rude
  const sq = squeeze(joined);
  return NAME_STRONG.some(b => joined.includes(b) || (squeeze(b).length > 2 && sq.includes(squeeze(b))));   // ("kkk" squeezed is just "k")
}
/** a notice-board message: the same check, but a few mild words are allowed */
const rudeText = text => rudeName(text, TEXT_OK);
if (typeof module !== 'undefined') module.exports = { rudeName, rudeText };
