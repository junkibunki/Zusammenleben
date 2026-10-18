import { untrack } from 'svelte';

// Satzpause und Trainingsdauer der Eintragsseite. Beide stehen als Zeitstempel
// im localStorage, damit sie Neuladen und das Anhalten im Hintergrund
// ueberleben: die Anzeige rechnet immer aus Date.now(), nie aus gezaehlten
// Ticks. Das Intervall laeuft nur, solange etwas zu zaehlen ist.

const REST_KEY = 'training.rest.';
const WATCH_KEY = 'training.watch.';
/** So lange steht "Pause vorbei" da, bevor die Leiste verschwindet. */
const DONE_SHOW_MS = 6000;
/** Nur so kurz nach dem Ende wird vibriert -- nicht nach Minuten im Hintergrund. */
const VIBRATE_WITHIN_MS = 3000;

export const timer = $state({
	now: Date.now(),
	/** Ende der Pause in ms, 0 = keine Pause. */
	restEnd: 0,
	/** Laenge der Pause in ms (fuer den Fortschrittsbalken). */
	restTotal: 0,
	/** Wann die letzte Pause abgelaufen ist, 0 = nicht (mehr) anzeigen. */
	restDoneAt: 0,
	/** Laufende Stoppuhr: `{ date, workout, start }` oder null. */
	watch: null
});

// Steuerung, kein $state (CLAUDE.md zu $effect-Schleifen).
let interval = null;
let active = false;
let user = '';

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
		navigator.vibrate?.([200, 100, 200]);
	} catch {
		// Kein Vibrationsmotor oder nicht erlaubt.
	}
}

function busy() {
	return timer.restEnd > 0 || timer.restDoneAt > 0 || timer.watch !== null;
}

function tick() {
	const now = Date.now();
	timer.now = now;
	if (timer.restEnd > 0 && now >= timer.restEnd) {
		if (now - timer.restEnd < VIBRATE_WITHIN_MS) vibrate();
		timer.restEnd = 0;
		timer.restDoneAt = now;
		write(REST_KEY + user, null);
	}
	if (timer.restDoneAt > 0 && now - timer.restDoneAt > DONE_SHOW_MS) timer.restDoneAt = 0;
	if (!busy()) stopInterval();
}

function schedule() {
	if (!active || interval !== null || !busy()) return;
	interval = setInterval(tick, 500);
}

function stopInterval() {
	if (interval === null) return;
	clearInterval(interval);
	interval = null;
}

function onVisible() {
	if (document.visibilityState === 'visible') {
		tick();
		schedule();
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
		schedule();
		return () => {
			active = false;
			stopInterval();
			document.removeEventListener('visibilitychange', onVisible);
		};
	});
}

// --- Satzpause --------------------------------------------------------------

/** Pause von `seconds` Sekunden starten (ersetzt eine laufende). */
export function startRest(seconds) {
	if (!(seconds > 0)) return;
	const now = Date.now();
	timer.now = now;
	timer.restTotal = seconds * 1000;
	timer.restEnd = now + timer.restTotal;
	timer.restDoneAt = 0;
	write(REST_KEY + user, { end: timer.restEnd, total: timer.restTotal });
	schedule();
}

/** Laufende Pause um `seconds` verlaengern. */
export function addRest(seconds) {
	if (timer.restEnd === 0) return;
	timer.restEnd += seconds * 1000;
	timer.restTotal += seconds * 1000;
	write(REST_KEY + user, { end: timer.restEnd, total: timer.restTotal });
}

/** Pause abbrechen bzw. "Pause vorbei" schliessen. */
export function skipRest() {
	timer.restEnd = 0;
	timer.restDoneAt = 0;
	write(REST_KEY + user, null);
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
