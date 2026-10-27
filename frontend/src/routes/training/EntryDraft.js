import { parseWeight, setsOf, SETS_MAX, NOTE_MAX } from '$lib/training.svelte.js';

// Entwuerfe der Eintragsseite: pro Uebung `{ rows, note, fresh }`, jede Zeile mit
// den Feldern als Text (so wie getippt) plus `warmup` und `done` (nur Anzeige).
// Erst parseRows() macht daraus Saetze fuer saveDay().
//
// `fresh`: der Entwurf ist nach dem Speichern geleert worden. Er steht dann fuer
// *neue* Saetze des Tages -- leer heisst "nichts zu tun" (nicht "alles loeschen"),
// und was man eintraegt, haengt saveDay() an den gespeicherten Eintrag an.

export const REPS_LIMIT = 1000;
export const SECONDS_LIMIT = 36000;

/** kg mit Komma oder Punkt, 0-1000; leer = null, Unsinn = NaN. */
export const parseKg = parseWeight;

function parseWhole(text, max) {
	const t = String(text ?? '').trim();
	if (t === '') return null;
	if (!/^\d+$/.test(t)) return NaN;
	const n = Number(t);
	return n > max ? NaN : n;
}

export const parseReps = (text) => parseWhole(text, REPS_LIMIT);
export const parseSeconds = (text) => parseWhole(text, SECONDS_LIMIT);

/** 62.5 -> "62,5", null -> "" */
export function toText(value) {
	return value === null || value === undefined ? '' : String(value).replace('.', ',');
}

export function emptyRow(warmup = false) {
	return { weight: '', reps: '', seconds: '', warmup, done: false };
}

/** Gespeicherter Satz -> Zeile. Bei Koerpergewicht heisst 0 kg "kein Zusatz". */
export function rowFromSet(set, kind) {
	const weight = kind === 'bodyweight' && !set.weight ? null : set.weight;
	return {
		weight: toText(weight),
		reps: toText(set.reps),
		seconds: toText(set.seconds),
		warmup: !!set.warmup,
		done: false
	};
}

/**
 * Ein gespeicherter Eintrag in der Form, die der Entwurf beim Speichern
 * haette: einmal durch Zeile und parseRows(). So vergleicht `dirty` Gleiches
 * mit Gleichem, auch wo die Umwandlung verlustbehaftet ist (0 kg Zusatz).
 */
export function savedEntry(log, kind) {
	if (!log) return null;
	const rows = setsOf(log).map((s) => rowFromSet(s, kind));
	return { sets: parseRows(kind, rows).sets, note: (log.note ?? '').trim() };
}

/**
 * Zeilen -> `{ sets, bad }`. Nur die Felder der Art zaehlen; Zeilen ganz ohne
 * Wert fallen weg. `bad` = mindestens ein Feld ist keine gueltige Zahl.
 */
export function parseRows(kind, rows) {
	let bad = false;
	const sets = [];
	for (const r of rows) {
		const weight = kind === 'time' ? null : parseKg(r.weight);
		const reps = kind === 'time' ? null : parseReps(r.reps);
		const seconds = kind === 'time' ? parseSeconds(r.seconds) : null;
		if (Number.isNaN(weight) || Number.isNaN(reps) || Number.isNaN(seconds)) {
			bad = true;
			continue;
		}
		if (weight === null && reps === null && seconds === null) continue;
		sets.push({ weight, reps, seconds, warmup: !!r.warmup });
	}
	return { sets, bad };
}

/** Entwurf aus dem gespeicherten Eintrag, ohne Eintrag `exercise.sets` leere Zeilen. */
export function draftFrom(exercise, log, kind) {
	const sets = log ? setsOf(log) : [];
	const count = Math.min(SETS_MAX, Math.max(1, exercise.sets || 1));
	const rows =
		sets.length > 0
			? sets.slice(0, SETS_MAX).map((s) => rowFromSet(s, kind))
			: Array.from({ length: count }, () => emptyRow());
	return { rows, note: log?.note ?? '', fresh: false };
}

/** Leerer Entwurf nach dem Speichern: neue Saetze kommen zum Tag dazu. */
export function freshDraft(exercise, kind) {
	return { ...draftFrom(exercise, null, kind), fresh: true };
}

// --- localStorage -----------------------------------------------------------

export function draftKey(userId, date) {
	return `training.draft.${userId}.${date}`;
}

function str(value) {
	if (typeof value === 'string') return value;
	return value === null || value === undefined ? '' : String(value);
}

/** So lange bleibt ein nie gespeicherter Entwurf liegen. */
const DRAFT_KEEP_DAYS = 30;

/** Entwuerfe fuer Tage, die laenger als DRAFT_KEEP_DAYS her sind, wegraeumen. */
function pruneDrafts() {
	const d = new Date(Date.now() - DRAFT_KEEP_DAYS * 86400000);
	const pad = (n) => String(n).padStart(2, '0');
	const cutoff = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	const stale = [];
	for (let i = 0; i < localStorage.length; i++) {
		const k = localStorage.key(i);
		const date = k?.startsWith('training.draft.') ? k.slice(-10) : '';
		if (date && date < cutoff) stale.push(k);
	}
	for (const k of stale) localStorage.removeItem(k);
}

/** Gespeicherte Entwuerfe eines Tages; alles Unlesbare faellt weg. */
export function readDrafts(key) {
	try {
		pruneDrafts();
		const data = JSON.parse(localStorage.getItem(key) ?? 'null');
		if (!data || typeof data !== 'object') return {};
		const out = {};
		for (const [id, d] of Object.entries(data)) {
			if (!d || !Array.isArray(d.rows)) continue;
			out[id] = {
				rows: d.rows.slice(0, SETS_MAX).map((r) => ({
					weight: str(r?.weight),
					reps: str(r?.reps),
					seconds: str(r?.seconds),
					warmup: !!r?.warmup,
					done: !!r?.done
				})),
				note: str(d.note).slice(0, NOTE_MAX),
				fresh: !!d.fresh
			};
		}
		return out;
	} catch {
		return {};
	}
}

/** `value` null oder leer loescht den Schluessel. */
export function writeDrafts(key, value) {
	try {
		if (value && Object.keys(value).length > 0) localStorage.setItem(key, JSON.stringify(value));
		else localStorage.removeItem(key);
	} catch {
		// Voll oder gesperrt: dann ueberlebt der Entwurf das Schliessen eben nicht.
	}
}
