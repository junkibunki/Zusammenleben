import { untrack } from 'svelte';

// Satzpause und Trainingsdauer der Eintragsseite. Beide stehen als Zeitstempel
// im localStorage, damit sie Neuladen und das Anhalten im Hintergrund
// ueberleben: die Anzeige rechnet immer aus Date.now(), nie aus gezaehlten
// Ticks. Das Intervall laeuft nur, solange etwas zu zaehlen ist.

const REST_KEY = 'training.rest.';
const WATCH_KEY = 'training.watch.';
const SOUND_KEY = 'training.sound';
/** So lange steht "Pause vorbei" da, wenn man es nicht wegtippt. */
const DONE_SHOW_MS = 60000;
/** Nur so kurz nach dem Ende wird vibriert/getoent -- nicht nach Minuten im Hintergrund. */
const VIBRATE_WITHIN_MS = 3000;
/** In den letzten so vielen Sekunden tickt es leise. */
export const COUNTDOWN_S = 3;

export const timer = $state({
	now: Date.now(),
	/** Ende der Pause in ms, 0 = keine Pause. */
	restEnd: 0,
	/** Laenge der Pause in ms (fuer den Fortschrittsbalken). */
	restTotal: 0,
	/** Wann die letzte Pause abgelaufen ist, 0 = nicht (mehr) anzeigen. */
	restDoneAt: 0,
	/** Laufende Stoppuhr: `{ date, workout, start }` oder null. */
	watch: null,
	/** Ton am Ende der Pause (pro Geraet, Vorgabe an). */
	sound: true
});

// Steuerung, kein $state (CLAUDE.md zu $effect-Schleifen).
let interval = null;
let active = false;
let user = '';
/** Zuletzt getickte Restsekunde, damit jede nur einmal tickt. */
let lastTick = 0;

function read(key) {
	try {
		const raw = localStorage.getItem(key);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

function write(key, value) {
	try {
		if (value == null) localStorage.removeItem(key);
		else localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Privater Modus o.ae.: dann ueberlebt es eben kein Neuladen.
	}
}

function vibrate() {
	try {
		navigator.vibrate?.([300, 120, 300, 120, 500]);
	} catch {
		// Kein Vibrationsmotor oder nicht erlaubt.
	}
}

// --- Ton --------------------------------------------------------------------
//
// Per Web Audio erzeugt, keine Audiodatei. Browser (vor allem iOS) lassen Ton
// erst nach einer Bedienung zu; deshalb wird der Kontext in startRest()
// angelegt bzw. fortgesetzt -- das laeuft im Tipp auf den Satz-Haken. Der
// Stummschalter des iPhones schaltet Web Audio trotzdem stumm.

let audio = null;

/** iOS setzt den Kontext beim Sperren auf "suspended" oder "interrupted". */
function resumeAudio() {
	if (audio && audio.state !== 'running') audio.resume().catch(() => {});
}

function unlockAudio() {
	if (!timer.sound) return;
	try {
		audio ??= new (window.AudioContext || window.webkitAudioContext)();
		resumeAudio();
		// Ein stiller Puffer im Tipp schaltet aeltere iOS-Versionen frei.
		const src = audio.createBufferSource();
		src.buffer = audio.createBuffer(1, 1, 22050);
		src.connect(audio.destination);
		src.start(0);
	} catch {
		audio = null;
	}
}

/** Einzelne Toene: `[Frequenz Hz, Start s, Dauer s, Lautstaerke 0..1]`. */
function play(notes) {
	if (!timer.sound || !audio) return;
	resumeAudio();
	try {
		const t0 = audio.currentTime + 0.02;
		for (const [freq, at, len, vol] of notes) {
			const osc = audio.createOscillator();
			const gain = audio.createGain();
			osc.type = 'sine';
			osc.frequency.value = freq;
			// Kurze Rampen, sonst knackt es am Anfang und Ende jedes Tons.
			gain.gain.setValueAtTime(0, t0 + at);
			gain.gain.linearRampToValueAtTime(vol, t0 + at + 0.01);
			gain.gain.setValueAtTime(vol, t0 + at + len - 0.03);
			gain.gain.linearRampToValueAtTime(0, t0 + at + len);
			osc.connect(gain).connect(audio.destination);
			osc.start(t0 + at);
			osc.stop(t0 + at + len + 0.02);
		}
	} catch {
		// Ton ist Beiwerk; die Anzeige reicht zur Not.
	}
}

/** Leises Ticken in den letzten Sekunden. */
function countdownTick() {
	play([[660, 0, 0.08, 0.25]]);
}

/** Ende der Pause: drei steigende Toene, der letzte laenger. */
function doneChime() {
	play([
		[880, 0, 0.15, 0.6],
		[1109, 0.2, 0.15, 0.6],
		[1319, 0.4, 0.4, 0.7]
	]);
}

/** Ton an/aus (pro Geraet). */
export function toggleSound() {
	timer.sound = !timer.sound;
	write(SOUND_KEY, timer.sound);
	if (timer.sound) {
		unlockAudio();
		countdownTick();
	}
}

// --- Bildschirm wach halten -------------------------------------------------
//
// Ohne Wake Lock sperrt das Handy waehrend einer 90-s-Pause, JS steht still,
// und Ton wie Vibration fallen aus. Gilt nur, solange eine Pause laeuft.
// Der Browser gibt die Sperre beim Verlassen der Seite selbst frei; onVisible
// fordert sie neu an. In der iOS-Homescreen-PWA erst ab iOS 18.4.

let wakeLock = null;
/** Eine Anfrage laeuft schon -- sonst entstuenden zwei Sperren, eine verwaist. */
let wakeLockPending = false;

function keepAwake() {
	if (wakeLock || wakeLockPending || timer.restEnd === 0) return;
	if (!navigator.wakeLock || document.visibilityState !== 'visible') return;
	wakeLockPending = true;
	navigator.wakeLock
		.request('screen')
		.then((lock) => {
			wakeLockPending = false;
			// Inzwischen vorbei oder die Seite verlassen: gleich wieder freigeben.
			if (timer.restEnd === 0 || !active) return lock.release();
			wakeLock = lock;
			lock.addEventListener('release', () => {
				if (wakeLock === lock) wakeLock = null;
			});
		})
		.catch(() => {
			// Abgelehnt (z.B. Energiesparmodus).
			wakeLockPending = false;
		});
}

function letSleep() {
	const lock = wakeLock;
	wakeLock = null;
	lock?.release().catch(() => {});
}

function busy() {
	return timer.restEnd > 0 || timer.restDoneAt > 0 || timer.watch !== null;
}

function tick() {
	const now = Date.now();
	timer.now = now;
	if (timer.restEnd > 0 && now < timer.restEnd) {
		const left = Math.ceil((timer.restEnd - now) / 1000);
		if (left <= COUNTDOWN_S && left !== lastTick) {
			lastTick = left;
			countdownTick();
		}
	}
	if (timer.restEnd > 0 && now >= timer.restEnd) {
		if (now - timer.restEnd < VIBRATE_WITHIN_MS) {
			vibrate();
			doneChime();
		}
		timer.restEnd = 0;
		timer.restDoneAt = now;
		write(REST_KEY + user, null);
		letSleep();
	}
	if (timer.restDoneAt > 0 && now - timer.restDoneAt > DONE_SHOW_MS) timer.restDoneAt = 0;
	if (!busy()) stopInterval();
}

function schedule() {
	if (!active || interval !== null || !busy()) return;
	interval = setInterval(tick, 250);
}

function stopInterval() {
	if (interval === null) return;
	clearInterval(interval);
	interval = null;
}

/** Freischalten bei einer echten Bedienung; Touch-pointerdown zaehlt dafuer nicht. */
function onTap() {
	unlockAudio();
	if (audio?.state === 'running') document.removeEventListener('click', onTap);
}

function onVisible() {
	if (document.visibilityState === 'visible') {
		resumeAudio();
		tick();
		schedule();
		keepAwake();
	}
}

/**
 * Laedt Pause und Stoppuhr aus dem localStorage und startet das Zaehlen.
 * Aufruf aus einem $effect; der Rueckgabewert ist das Teardown. Liest den
 * Zustand nur ungetrackt, sonst haengte der Effekt an dem, was er schreibt.
 */
export function startTimers(userId) {
	return untrack(() => {
		active = true;
		user = userId;
		timer.sound = read(SOUND_KEY) !== false;
		const now = Date.now();
		const rest = read(REST_KEY + user);
		if (rest && rest.end > now) {
			timer.restEnd = rest.end;
			timer.restTotal = rest.total > 0 ? rest.total : rest.end - now;
		} else {
			timer.restEnd = 0;
			write(REST_KEY + user, null);
		}
		timer.restDoneAt = 0;
		const w = read(WATCH_KEY + userId);
		timer.watch =
			w && typeof w.date === 'string' && w.start > 0 && w.start <= now
				? { date: w.date, workout: String(w.workout ?? ''), start: w.start }
				: null;
		timer.now = now;
		document.addEventListener('visibilitychange', onVisible);
		// Nach einem Neuladen ist der Ton gesperrt, bis man irgendwo tippt.
		document.addEventListener('click', onTap);
		schedule();
		keepAwake();
		return () => {
			active = false;
			stopInterval();
			letSleep();
			document.removeEventListener('visibilitychange', onVisible);
			document.removeEventListener('click', onTap);
			// Den Audio-Thread nicht die ganze Sitzung laufen lassen (Akku).
			audio?.suspend().catch(() => {});
		};
	});
}

// --- Satzpause --------------------------------------------------------------

/** Pause von `seconds` Sekunden starten (ersetzt eine laufende). */
export function startRest(seconds) {
	if (!(seconds > 0)) return;
	unlockAudio();
	lastTick = 0;
	const now = Date.now();
	timer.now = now;
	timer.restTotal = seconds * 1000;
	timer.restEnd = now + timer.restTotal;
	timer.restDoneAt = 0;
	write(REST_KEY + user, { end: timer.restEnd, total: timer.restTotal });
	schedule();
	keepAwake();
}

/** Laufende Pause um `seconds` verlaengern. */
export function addRest(seconds) {
	if (timer.restEnd === 0) return;
	timer.restEnd += seconds * 1000;
	timer.restTotal += seconds * 1000;
	lastTick = 0;
	write(REST_KEY + user, { end: timer.restEnd, total: timer.restTotal });
}

/** Pause abbrechen bzw. "Pause vorbei" schliessen. */
export function skipRest() {
	timer.restEnd = 0;
	timer.restDoneAt = 0;
	write(REST_KEY + user, null);
	letSleep();
	if (!busy()) stopInterval();
}

/** Restliche Sekunden der Pause (aufgerundet). */
export function restLeft() {
	return Math.max(0, Math.ceil((timer.restEnd - timer.now) / 1000));
}

/** Anteil der Pause, der noch uebrig ist, 0..1. */
export function restFraction() {
	if (timer.restEnd === 0 || timer.restTotal <= 0) return 0;
	return Math.min(1, Math.max(0, (timer.restEnd - timer.now) / timer.restTotal));
}

// --- Trainingsdauer ---------------------------------------------------------

/** Stoppuhr fuer das Training an `date` starten. */
export function startWatch(date, workoutId) {
	const now = Date.now();
	timer.now = now;
	timer.watch = { date, workout: workoutId ?? '', start: now };
	write(WATCH_KEY + user, timer.watch);
	schedule();
}

/** Sekunden seit dem Start der Stoppuhr (0 ohne laufende). */
export function watchElapsed() {
	if (!timer.watch) return 0;
	return Math.max(0, (timer.now - timer.watch.start) / 1000);
}

/** Stoppuhr verwerfen -- nach dem Speichern der Dauer. */
export function clearWatch() {
	timer.watch = null;
	write(WATCH_KEY + user, null);
	if (!busy()) stopInterval();
}
