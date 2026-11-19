// The burpee camera station course (19 November 2026): what used to be Learning's Cameras guide, as a programme referees enrol in and
// complete, with an assessment and a demonstration credential. Taught from SpartanReferee's own camera guides (streaming.html,
// phone.html) and how the site works, so it isn't Spartan rule content and cites no rules. The last lesson holds the free camera and,
// for head referees and admins, the 30-minute practice server (slides with an "action"). Loaded by scripts/learn-seed.mjs.

export const CAMERA = {
  id: 'camera-station', code: 'cam', title: 'Burpee camera station', category: 'referee', learnerRole: 'Camera station referee', locales: 'en',
  description: 'How SpartanReferee\'s burpee camera station works, and how to set it up, connect the phones, judge with the AI judge, sort out problems and practise. For every referee: the head referee books and runs it, and everyone watches and reviews.',
  version: {
    edition: '2027', completionRule: 'lessons+assessment', passMark: 80, maxAttempts: null, retakeWaitHours: 0, validityMonths: 12, renewalDueDays: 30,
    qualification: 'Burpee camera station 2027', policyNote: 'Sample policy for the demonstration: the officiating lead decides whether this course is required and for whom.',
  },
  modules: [
    { title: 'Before the event', source: 'SpartanReferee camera guides', summary: 'What the station does, how it\'s booked and what you need.', lessons: [
      { key: 'cam-1-1', title: 'How the camera station works', minutes: 3, summary: 'Phones film the penalty station, a server judges every rep, and every referee watches in a browser.' },
      { key: 'cam-1-2', title: 'Booking and the event day', minutes: 3, summary: 'Who books, the hours, how many servers, and the venue\'s connection.' },
      { key: 'cam-1-3', title: 'What you need', minutes: 2, summary: 'Phones, stands, power, the apps, and something to watch on.' }] },
    { title: 'Setting up', source: 'SpartanReferee camera guides', summary: 'Placing the phones and connecting them to the booking.', lessons: [
      { key: 'cam-2-1', title: 'Placing a camera', minutes: 3, summary: 'Distance, angle and keeping the lanes clear.' },
      { key: 'cam-2-2', title: 'Connecting a phone', minutes: 4, summary: 'The QR codes, Android with SpartanReferee Broadcaster and iPhone with Larix.' }] },
    { title: 'Judging with the cameras', source: 'SpartanReferee camera guides', summary: 'Starting the AI judge, reviewing results and fixing problems.', lessons: [
      { key: 'cam-3-1', title: 'Starting the AI judge', minutes: 3, summary: 'Naming a camera, choosing the exercise and checking with test reps.' },
      { key: 'cam-3-2', title: 'Results and review', minutes: 3, summary: 'Finding an athlete, watching every rep and no rep, and how long it\'s kept.' },
      { key: 'cam-3-3', title: 'If something goes wrong', minutes: 3, summary: 'Phones that won\'t connect, poor pictures, blocked networks and servers that don\'t start.' }] },
    { title: 'Practise', source: 'SpartanReferee', summary: 'Try the AI judge yourself, and rehearse the real station.', lessons: [
      { key: 'cam-4-1', title: 'Practise with the cameras', minutes: 5, summary: 'The free camera for everyone; a 30-minute practice server for head referees.' }] },
  ],
};

const S = 'SpartanReferee camera guides (streaming.html, phone.html) and the camera station as built, November 2026.';
export const CAMERA_LESSONS = {
  'cam-1-1': { sources: S, en: [
    { heading: 'Cameras on the penalty station', figure: 'network', points: ['Phones film the burpee penalty zone', 'A SpartanReferee server records them and runs an AI judge on every camera', 'Every rep is counted and checked against the standard'],
      narration: 'SpartanReferee films the penalty station on phones. Each phone sends its picture to a SpartanReferee server over Wi-Fi or mobile data. The server records it and runs an AI judge on every camera, so each rep is counted and checked against the movement standard.' },
    { heading: 'Who does what', figure: 'referee', points: ['The event\'s head referee books the station and runs it', 'Every referee assigned to the event can watch it live and review the results', 'Admins can book, extend or stop any event\'s cameras'],
      narration: 'Each event has one camera booking. The head referee books it from the event page and runs it on the day. Every referee assigned to the event can open it to watch the cameras live and review the results. Admins can step in and book, extend or stop any event\'s cameras.' },
    { heading: 'In short', figure: 'summary', points: ['Phones film, the server judges, everyone watches in a browser', 'The head referee books and runs it'],
      narration: 'In short: phones film, the server judges, and every referee watches in a browser. The head referee books and runs it.' }] },
  'cam-1-2': { sources: S, en: [
    { heading: 'Your events', figure: 'referee', points: ['Your events are on your home page', 'Open one to see its camera hours and who\'s refereeing it', 'The head referee sees Book the burpee cameras there'],
      narration: 'Your events are on your SpartanReferee home page. Open one to see its camera hours and who is refereeing it. If you are its head referee, that is where you book the burpee cameras.' },
    { heading: 'The hours', figure: 'placeholder', points: ['Cameras run from 07:00 to 18:00 local time on each day of the event', 'Times are entered in the event\'s own local time', 'A booking made ahead starts its servers 10 minutes early; starting now takes about 5 minutes'],
      narration: 'An event\'s cameras run from seven in the morning to six in the evening, local time, on each of its days. Booking times are in the event\'s own local time, wherever you book from. A booking made ahead starts its servers ten minutes early, so the cameras are ready on time. Starting one straight away takes about five minutes.' },
    { heading: 'Servers and the connection', figure: 'network', points: ['Each server takes 2 cameras', 'Each camera sends about 3.5 Mbit/s', 'Check the venue\'s connection before the day: it has to carry every camera'],
      narration: 'Each server takes two cameras, so the number of cameras sets the number of servers. Each camera sends about three and a half megabits a second, and the venue\'s connection has to carry all of them. Check it before the day.' }] },
  'cam-1-3': { sources: S, en: [
    { heading: 'For each camera', figure: 'camera', points: ['A phone on a tripod or stand', 'A power bank', 'Mobile data or the venue\'s Wi-Fi'],
      narration: 'For each camera you need a phone on a tripod or stand, a power bank to keep it going all day, and mobile data or the venue\'s Wi-Fi.' },
    { heading: 'The apps', figure: 'qr', points: ['Android: the SpartanReferee Broadcaster app', 'iPhone: Larix Broadcaster, from the App Store', 'To watch and judge: any phone, tablet or computer with a browser, with nothing to install'],
      narration: 'Android phones use the SpartanReferee Broadcaster app. iPhones use Larix Broadcaster, from the App Store. To watch the cameras and judge, any phone, tablet or computer with a browser will do: there is nothing to install on it.' }] },
  'cam-2-1': { sources: S, en: [
    { heading: 'Where the phone goes', figure: 'camera', points: ['Landscape, on its stand', '3 to 4 metres from the athletes', 'Each athlete\'s whole body in the picture, including lying flat'],
      narration: 'Put the phone in landscape on its stand, three to four metres from the athletes. Keep each athlete\'s whole body in the picture, including when they lie flat on the ground.' },
    { heading: 'The angle', figure: 'camera', points: ['Slightly angled or side-on judges chest to the ground better than straight on', 'Push-ups and sit-ups need the phone side-on at floor level'],
      narration: 'A slightly angled or side-on view judges chest to the ground better than a camera straight on. For push-ups and sit-ups, put the phone side-on at floor level.' },
    { heading: 'Keep the lanes clear', figure: 'referee', points: ['Officials in hi-vis yellow tops are never counted as athletes', 'Anyone else standing in front of a camera gets in the way', 'Stand where you can see the athletes without blocking the view'],
      narration: 'Officials in hi-vis yellow tops are never counted as athletes. Anyone else standing in front of a camera gets in the way, so keep the lanes clear, and stand where you can see the athletes without blocking the cameras.' }] },
  'cam-2-2': { sources: S, en: [
    { heading: 'The QR codes', figure: 'qr', points: ['Open the booking on the console once it\'s on', 'Each camera waiting for its phone shows QR codes on the Live and Cameras tabs', 'The codes change with every booking: scan them again each time'],
      narration: 'Once the booking is on, open it on the console. Each camera that is waiting for its phone shows QR codes on the Live and Cameras tabs. The codes change with every booking, so scan them again each time.' },
    { heading: 'Android: SpartanReferee Broadcaster', figure: 'qr', points: ['Install the app; allow installing from this source when the phone asks', 'Tap Scan the camera\'s QR code and scan that camera\'s code', 'Leave the quality on 720p unless the signal is weak, then Open the camera and GO LIVE'],
      narration: 'On Android, install SpartanReferee Broadcaster. The phone warns you because it is not from the Play Store: tap Settings, allow installing from this source, go back and install. Tap Scan the camera\'s QR code and scan that camera\'s code. Leave the quality on 720p unless the signal is weak, then tap Open the camera and Go live.' },
    { heading: 'iPhone: Larix Broadcaster', figure: 'qr', points: ['Install Larix and open it once, allowing the camera and microphone', 'Scan the camera\'s iPhone (Larix) code with the phone\'s camera, open the link in Larix and tap Import', 'In Larix: Settings, Connections, tick the camera, then press the red button'],
      narration: 'On an iPhone, install Larix Broadcaster and open it once, allowing the camera and microphone. Scan the camera\'s iPhone code with the phone\'s own camera, open the link in Larix and tap Import. Then in Larix go to Settings, Connections, tick the camera, and press the red button.' }] },
  'cam-3-1': { sources: S, en: [
    { heading: 'Start the judge', figure: 'network', points: ['Each phone\'s picture shows on the Live tab within a few seconds', 'Press Start AI judge on a camera, name it and choose the exercise', 'Then Start judging: it runs on the server, so it carries on when you close the page'],
      narration: 'Each phone\'s picture shows on the Live tab within a few seconds of going live. Press Start AI judge on a camera, give it a name, choose what it is judging, and press Start judging. The judge runs on the server, so it carries on when you close the page.' },
    { heading: 'What it checks on a burpee', figure: 'burpee', points: ['Chest to the ground', 'Full hip extension', 'A jump, both feet off', 'Hands over the ears'],
      narration: 'On a burpee the judge checks four things: chest to the ground, full hip extension, a jump with both feet off the ground, and hands over the ears. A rep that misses one is a no rep.' },
    { heading: 'Test it', figure: 'summary', points: ['Do a few test reps in front of each camera', 'Check each one is counted, and a bad one isn\'t', 'Move the phone if an athlete leaves the picture'],
      narration: 'Before athletes arrive, do a few test reps in front of each camera and check they are counted, and that a deliberately bad one is not. If the athlete leaves the picture, move the phone.' }] },
  'cam-3-2': { sources: S, en: [
    { heading: 'Results', figure: 'referee', points: ['Results lists everyone judged', 'Find athlete number searches every camera', 'Watch plays an athlete with every rep and no rep marked'],
      narration: 'The Results tab lists everyone judged. Find athlete number searches every camera for one athlete. Watch plays that athlete back with every rep and every no rep marked.' },
    { heading: 'How long it\'s kept', figure: 'placeholder', points: ['Recordings and results are kept for 7 days', 'At the end of the booking the recordings are saved and the servers shut down', 'Every referee on the event can review them'],
      narration: 'Recordings and results are kept for seven days. When the booking ends, the recordings are saved and the servers shut down. Every referee on the event can review them in that time.' }] },
  'cam-3-3': { sources: S, en: [
    { heading: 'Phones and pictures', figure: 'camera', points: ['Won\'t connect: check its signal, and scan its code again from this booking', 'Stutters or drops: the signal is too weak for 720p, so pick a lower quality', 'A camera but no picture: the venue\'s network may block video, so try the phone\'s mobile data'],
      narration: 'If a phone will not connect, check its signal and scan its code again from this booking. If the picture stutters or drops, the signal is too weak for 720p: pick a lower quality. If a camera shows but with no picture, the venue\'s network may be blocking video: try the phone\'s mobile data instead.' },
    { heading: 'Servers and the internet', figure: 'network', points: ['The server didn\'t start: the console says why; sometimes Azure has no server free for a few minutes, so try again', 'The venue\'s internet fails: nothing reaches the server until it\'s back', 'Only Larix keeps its own copy on the phone'],
      narration: 'If the server did not start, the console says why. Sometimes there is no server free for a few minutes: try again. If the venue\'s internet fails, nothing reaches the server until it is back, and only Larix keeps its own copy of the video on the phone.' }] },
  'cam-4-1': { sources: S, en: [
    { heading: 'The free camera', figure: 'burpee', action: 'free-camera', points: ['The AI judge runs in your own browser, on this phone\'s or computer\'s camera', 'No server and no cost, at any time', 'Prop the phone up, do a few burpees, and see each one judged'],
      narration: 'The free camera runs the AI judge right in your browser, on your own phone\'s or computer\'s camera, live or on a minute of video. There is no server and no cost, and you can use it at any time. Prop the phone up, do a few burpees, and watch each one judged.' },
    { heading: 'Rehearse the real station', figure: 'network', action: 'practice-camera', points: ['Head referees can book a 30-minute practice server', 'Phones scan their codes, the console, the judge and the review, as at an event', 'It uses one of the servers events need, so it\'s for head referees and admins'],
      narration: 'Head referees can also book a thirty-minute practice server, to rehearse the whole station: the phones scanning their codes, the console, the judge and the review, just as at an event. It uses one of the servers events need, so it is for head referees and admins.' }] },
};

export const CAMERA_ASSESSMENT = {
  title: 'Camera station check',
  description: 'Eight questions on setting up and running the burpee camera station.',
  questions: [
    { type: 'single', rules: [], prompt: 'Who books an event\'s burpee cameras?',
      options: [{ text: 'The event\'s head referee (or an admin)', correct: true }, { text: 'Any referee at the event' }, { text: 'The race director' }, { text: 'Each referee books their own camera' }],
      feedback: 'The head referee books and runs the station from the event page; admins can too. Every referee on the event can watch and review.' },
    { type: 'single', rules: [], prompt: 'How far from the athletes should a camera phone be?',
      options: [{ text: '1 metre' }, { text: '3 to 4 metres', correct: true }, { text: '10 metres' }, { text: 'As far as the lane allows' }],
      feedback: '3 to 4 metres, in landscape, with each athlete\'s whole body in the picture, including lying flat.' },
    { type: 'single', rules: [], prompt: 'Which view judges chest to the ground best on a burpee?',
      options: [{ text: 'Straight on, at head height' }, { text: 'Slightly angled or side-on', correct: true }, { text: 'From directly above' }, { text: 'From behind the athlete' }],
      feedback: 'A slightly angled or side-on view shows the chest reaching the ground better than a camera straight on.' },
    { type: 'single', rules: [], prompt: 'You reuse a phone from last weekend\'s event. What do you do with its QR code?',
      options: [{ text: 'Nothing: it remembers the camera' }, { text: 'Scan the camera\'s code again from this booking', correct: true }, { text: 'Type in the old server address' }, { text: 'Ask an admin to copy the old booking' }],
      feedback: 'The codes change with every booking, so scan them again each time.' },
    { type: 'multiple', rules: [], prompt: 'Which does the AI judge check on a burpee? Choose all that apply.',
      options: [{ text: 'Chest to the ground', correct: true }, { text: 'Full hip extension', correct: true }, { text: 'A jump with both feet off', correct: true }, { text: 'Hands over the ears', correct: true }, { text: 'The athlete\'s race time' }],
      feedback: 'Chest to the ground, full hip extension, a jump with both feet off and hands over the ears. Race times aren\'t part of it.' },
    { type: 'single', rules: [], prompt: 'A phone\'s picture keeps stuttering. What\'s the first thing to try?',
      options: [{ text: 'Book another server' }, { text: 'Pick a lower quality than 720p', correct: true }, { text: 'Restart the AI judge' }, { text: 'Move the phone closer to the athletes' }],
      feedback: 'Stuttering means the signal is too weak for 720p: pick a lower quality.' },
    { type: 'single', rules: [], prompt: 'How long are recordings and results kept?',
      options: [{ text: 'Until the end of the event day' }, { text: '7 days', correct: true }, { text: '30 days' }, { text: 'For ever' }],
      feedback: 'Recordings and results are kept for 7 days.' },
    { type: 'single', rules: [], prompt: 'You aren\'t a head referee and want to try the AI judge. What do you use?',
      options: [{ text: 'The free camera, in your browser', correct: true }, { text: 'A 30-minute practice server' }, { text: 'Your next event\'s booking' }, { text: 'Nothing: only head referees can try it' }],
      feedback: 'The free camera runs the judge in your own browser at no cost. Practice servers are for head referees and admins, as they use servers events need.' },
  ],
};
