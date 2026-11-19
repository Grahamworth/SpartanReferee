// Lesson content for the learning platform's demonstration (step 3), loaded by scripts/learn-seed.mjs.
// The one complete demonstration lesson (the brief: "an obstacle failure-condition case") is taught from the 2026 rulebook. Where the
// 2026 sources disagree, the slide says so ("review") instead of picking an answer (RUL-04). The Spanish is a machine translation sent
// for review, so learners see it as a Preview translation (NFR-06). Rule ids (OCR-2026-4.2.13) are the rule references of step 5.

import { CAMERA_LESSONS } from './learn-camera-course.mjs';
import { OCR_LESSONS } from './learn-ocr-lessons.mjs';
import { ESSENTIALS_LESSONS } from './learn-essentials.mjs';

const SPEAR_SOURCES = 'Spartan OCR Rules of Competition 2026: 3.17.3 to 3.17.5, 4.2 and 4.2.13. Spartan Referee Online Program 2026: slides 23, 24, 29 and 31. Officiating SOP 2026: 5.2.4.';
const SPEAR_EN = [
  { heading: 'A single-attempt obstacle', figure: 'lane', rules: ['OCR-2026-4.2', 'OCR-2026-4.2.13'],
    points: ['One throw: a miss is a fail, and a fail means the penalty', 'Your job: see the attempt start, judge the result, send the athlete to the penalty'],
    narration: 'The Spear Throw is a single-attempt, pass or fail obstacle. Each athlete gets one throw. If it fails, there is no second try: they go straight to the penalty. Your job at the Spear Throw is to see exactly when the attempt starts, judge the result, and direct the athlete to the right penalty.' },
  { heading: 'What the athlete must do', figure: 'barrier', rules: ['OCR-2026-4.2.13'],
    points: ['Stand with both feet behind the barrier', 'Throw the spear at the target in the same lane', 'The spear embeds in the indicated target and stays there, with no part touching the ground'],
    narration: 'Under rule 4.2.13, the athlete stands with both feet behind the barrier and throws at the target in their own lane. To pass, the spear has to embed in the indicated target and stay there, with no part of the spear touching the ground.' },
  { heading: 'When the attempt starts', figure: 'release', rules: ['OCR-2026-4.2.13'],
    points: ['It is an attempt once the spear is released in a forward motion', 'Changing lanes is allowed, but only before the attempt', 'A tangled tether that spoils the throw still counts as an attempt'],
    narration: "The rulebook says the attempt starts once the athlete releases the spear in a forward motion. Before that, they may change lanes. After it, they can't reset. And if the tether tangles and spoils the throw, it still counts: keeping the tether clear is the athlete's job.",
    review: 'Under review for 2027: the 2026 online programme says commitment starts earlier, when the spear is drawn back to throw. The rulebook says on release. Until the officiating lead rules, apply the rulebook and refer a disputed call to the Head Referee.' },
  { heading: 'Pass or fail', figure: 'target', rules: ['OCR-2026-4.2.13'],
    points: ["Fail: the spear doesn't embed in the indicated target", 'Fail: any part of the spear touches the ground once it is still', 'Not a fail on its own: brushing the ground in flight, if it ends up in the target clear of the ground'],
    narration: "There are two ways to fail. The spear doesn't embed in the indicated target, or any part of it is touching the ground once it has stopped. A spear may brush the ground on the way, and that alone isn't a fail, as long as it ends up in the target and clear of the ground.",
    review: 'Under review for 2027: the 2026 online programme lists "spear touches ground before target" as a failure. Rule 4.2.13 allows it. Apply the rulebook until the officiating lead rules.' },
  { heading: 'When it is complete', figure: 'distance', rules: ['OCR-2026-4.2.13'],
    points: ['Complete once the athlete has moved at least 2 metres away from the lane', "They can't leave until the spear has hit the target, the structure or the ground", 'A fall or failure before they are 2 metres away is an incomplete attempt: penalty'],
    narration: "The obstacle is complete once the athlete has moved at least two metres away from their lane. They can't leave before the spear has hit the target, the structure, or the ground. If the spear falls out before they are two metres away, it is an incomplete attempt, and the penalty applies." },
  { heading: 'The penalty', figure: 'burpee', rules: ['OCR-2026-4.2.13', 'OCR-2026-3.17.3', 'OCR-2026-3.17.4', 'OCR-2026-3.17.5'],
    points: ['30 burpees (15 at Stadion events)', "In the designated burpee zone: burpees outside it don't count", 'Each to the standard: chest to the ground, upright, then a jump with hands above the ears'],
    narration: "The penalty for failing the Spear Throw is thirty burpees, or fifteen at Stadion events. They must be done in the designated burpee zone, because burpees outside it don't count. Each one has to meet the standard: chest to the ground, back to a balanced upright position, then a jump with the hands above the ears.",
    review: "Under review for 2027: the time added for missed burpees differs between the rulebook (3.4.2), the Officiating SOP and the 2026 programme. This lesson doesn't teach a figure until the officiating lead rules." },
  { heading: 'What you do', figure: 'referee', rules: ['OCR-2026-3.17.5'],
    points: ['Stand where you can see the release, the barrier and the target', 'Call the result clearly and calmly', 'Send the athlete to the burpee zone, where the camera can see their headband number', "Refer any dispute to the Head Referee: don't argue at the obstacle"],
    narration: "Stand where you can see the release, the barrier and the target at the same time. Call the result clearly and calmly. Send the athlete to the burpee zone, and make sure the camera can see their headband number. If the athlete disputes the call, note the number and refer it to the Head Referee. Don't argue at the obstacle." },
  { heading: 'In short', figure: 'summary', rules: ['OCR-2026-4.2.13'],
    points: ['One throw: the attempt starts when the spear is released forward', 'Pass: in the target, nothing touching the ground once it is still', 'Complete: 2 metres away from the lane', 'Fail: 30 burpees in the zone, each to the standard'],
    narration: 'In short. One throw, and the attempt starts when the spear is released forward. A pass is a spear in the target with nothing touching the ground once it is still. The athlete is done when they are two metres away from the lane. A fail is thirty burpees in the burpee zone, each one to the standard.' },
];
const SPEAR_ES = [
  { heading: 'Un obstáculo de un solo intento', points: ['Un lanzamiento: fallar es no superarlo, y no superarlo significa penalización', 'Tu trabajo: ver cuándo empieza el intento, juzgar el resultado y enviar al atleta a la penalización'],
    narration: 'El lanzamiento de jabalina es un obstáculo de un solo intento, de superado o no superado. Cada atleta tiene un lanzamiento. Si falla, no hay segundo intento: va directamente a la penalización. Tu trabajo en el lanzamiento de jabalina es ver exactamente cuándo empieza el intento, juzgar el resultado y dirigir al atleta a la penalización correcta.' },
  { heading: 'Qué debe hacer el atleta', points: ['Colocarse con ambos pies detrás de la barrera', 'Lanzar la jabalina a la diana de su mismo carril', 'La jabalina se clava en la diana indicada y se queda ahí, sin que ninguna parte toque el suelo'],
    narration: 'Según la regla 4.2.13, el atleta se coloca con ambos pies detrás de la barrera y lanza a la diana de su propio carril. Para superarlo, la jabalina tiene que clavarse en la diana indicada y quedarse ahí, sin que ninguna parte de la jabalina toque el suelo.' },
  { heading: 'Cuándo empieza el intento', points: ['Es un intento en cuanto la jabalina se suelta con un movimiento hacia delante', 'Se puede cambiar de carril, pero solo antes del intento', 'Si la cuerda se enreda y estropea el lanzamiento, sigue contando como intento'],
    narration: 'El reglamento dice que el intento empieza en cuanto el atleta suelta la jabalina con un movimiento hacia delante. Antes de eso, puede cambiar de carril. Después, no puede volver a empezar. Y si la cuerda se enreda y estropea el lanzamiento, sigue contando: mantener la cuerda despejada es responsabilidad del atleta.',
    review: 'En revisión para 2027: el programa en línea de 2026 dice que el compromiso empieza antes, cuando se echa la jabalina hacia atrás para lanzar. El reglamento dice al soltarla. Hasta que decida el responsable de arbitraje, aplica el reglamento y remite cualquier decisión discutida al árbitro principal.' },
  { heading: 'Superado o no superado', points: ['No superado: la jabalina no se clava en la diana indicada', 'No superado: cualquier parte de la jabalina toca el suelo una vez quieta', 'No es un fallo por sí solo: rozar el suelo en vuelo, si acaba en la diana sin tocar el suelo'],
    narration: 'Hay dos formas de no superarlo. La jabalina no se clava en la diana indicada, o alguna parte toca el suelo una vez que se ha detenido. La jabalina puede rozar el suelo por el camino, y eso por sí solo no es un fallo, siempre que acabe en la diana y sin tocar el suelo.',
    review: 'En revisión para 2027: el programa en línea de 2026 indica como fallo que la jabalina toque el suelo antes de la diana. La regla 4.2.13 lo permite. Aplica el reglamento hasta que decida el responsable de arbitraje.' },
  { heading: 'Cuándo se ha completado', points: ['Completado cuando el atleta se ha alejado al menos 2 metros del carril', 'No puede irse hasta que la jabalina haya tocado la diana, la estructura o el suelo', 'Una caída o un fallo antes de alejarse 2 metros es un intento incompleto: penalización'],
    narration: 'El obstáculo está completado cuando el atleta se ha alejado al menos dos metros de su carril. No puede irse antes de que la jabalina haya tocado la diana, la estructura o el suelo. Si la jabalina se cae antes de que esté a dos metros, es un intento incompleto y se aplica la penalización.' },
  { heading: 'La penalización', points: ['30 burpees (15 en las pruebas Stadion)', 'En la zona de burpees designada: los que se hagan fuera no cuentan', 'Cada uno según el estándar: pecho al suelo, de pie, y un salto con las manos por encima de las orejas'],
    narration: 'La penalización por no superar el lanzamiento de jabalina es de treinta burpees, o quince en las pruebas Stadion. Deben hacerse en la zona de burpees designada, porque los que se hacen fuera no cuentan. Cada uno tiene que cumplir el estándar: pecho al suelo, volver a una posición erguida y equilibrada, y después un salto con las manos por encima de las orejas.',
    review: 'En revisión para 2027: el tiempo añadido por burpees no realizados difiere entre el reglamento (3.4.2), el procedimiento operativo de arbitraje y el programa de 2026. Esta lección no enseña una cifra hasta que decida el responsable de arbitraje.' },
  { heading: 'Qué haces tú', points: ['Colócate donde veas el lanzamiento, la barrera y la diana', 'Anuncia el resultado con claridad y calma', 'Envía al atleta a la zona de burpees, donde la cámara vea su número de la cinta', 'Remite cualquier discusión al árbitro principal: no discutas en el obstáculo'],
    narration: 'Colócate donde puedas ver a la vez el lanzamiento, la barrera y la diana. Anuncia el resultado con claridad y calma. Envía al atleta a la zona de burpees y asegúrate de que la cámara vea su número de la cinta. Si el atleta discute la decisión, anota el número y remítelo al árbitro principal. No discutas en el obstáculo.' },
  { heading: 'En resumen', points: ['Un lanzamiento: el intento empieza cuando la jabalina se suelta hacia delante', 'Superado: en la diana, sin nada tocando el suelo una vez quieta', 'Completado: a 2 metros del carril', 'No superado: 30 burpees en la zona, cada uno según el estándar'],
    narration: 'En resumen. Un lanzamiento, y el intento empieza cuando la jabalina se suelta hacia delante. Superado es una jabalina en la diana sin nada tocando el suelo una vez quieta. El atleta ha terminado cuando está a dos metros del carril. No superado son treinta burpees en la zona de burpees, cada uno según el estándar.' },
].map((s, i) => ({ ...s, figure: SPEAR_EN[i].figure, rules: SPEAR_EN[i].rules }));

const DEKA_EN = [
  { heading: 'A sample lesson', figure: 'placeholder', rules: [], points: ['This programme is a placeholder', 'Its lesson and quiz show how a second programme works', "None of it is DEKA's rules"],
    narration: "This is a sample lesson in a placeholder programme. It shows how a second programme sits beside the OCR one, with its own lessons, quiz, pass mark and credential. Nothing here is DEKA's actual rules: those come from DEKA's programme owners." },
  { heading: 'Counting reps (sample)', figure: 'placeholder', rules: [], points: ['A judge counts each rep that meets the standard', "A rep that doesn't is a no-rep, called clearly"],
    narration: "In this sample, a judge counts each repetition that meets the movement standard, and calls a no-rep clearly when one doesn't. The real standards and calls will come with DEKA's own material." },
  { heading: 'In short (sample)', figure: 'summary', rules: [], points: ['Placeholder content only', 'The quiz that follows is a sample too'],
    narration: 'That is the end of the sample lesson. The quiz that follows is a sample too, to show how each programme keeps its own assessment and credential.' },
];

export const LESSONS = {
  ...CAMERA_LESSONS,
  ...OCR_LESSONS,
  ...ESSENTIALS_LESSONS,
  'ocr-4-2': { sources: SPEAR_SOURCES, en: SPEAR_EN, es: SPEAR_ES, esBy: 'Claude (machine translation), not reviewed' },
  'deka-1-1': { sources: 'Placeholder content written for the demonstration, not DEKA material.', en: DEKA_EN },
};

// every lesson in the other languages (machine translations, 19 November 2026): scripts/learn-translations/<code>.json, { lesson key: slides }
import fs from 'node:fs';
const TR = new URL('./learn-translations/', import.meta.url);
export const TRANSLATIONS = Object.fromEntries(fs.readdirSync(TR).filter((f) => /^[a-z]{2}\.json$/.test(f)).sort()
  .map((f) => [f.slice(0, 2), JSON.parse(fs.readFileSync(new URL(f, TR), 'utf8'))]));
