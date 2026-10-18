import { pb } from './pocketbase.svelte.js';

// Trainingsplan der angemeldeten Person (Migrationen 1789563600, 1789650000).
// Privat: weder der Haushalt noch sonst jemand sieht ihn. Daher auch keine
// Realtime -- es schreibt niemand ausser einem selbst.
//
// Aufbau: mehrere Trainings (z.B. Push, Pull, Beine), jedes mit eigenen
// Uebungen; pro Uebung und Tag ein geschafftes Gewicht. Die Trainingstage samt
// Erinnerung gelten fuer die Person, nicht fuer ein einzelnes Training.

/** Maximale Laengen -- muessen mit den Migrationen uebereinstimmen. */
export const EXERCISE_MAX = 60;
export const WORKOUT_MAX = 40;

/** Wochentage in der Reihenfolge der Anzeige; `id` = Wert im Feld `days`. */
export const WEEKDAYS = [
	{ id: 'mo', short: 'Mo', long: 'Montag' },
	{ id: 'di', short: 'Di', long: 'Dienstag' },
	{ id: 'mi', short: 'Mi', long: 'Mittwoch' },
	{ id: 'do', short: 'Do', long: 'Donnerstag' },
	{ id: 'fr', short: 'Fr', long: 'Freitag' },
	{ id: 'sa', short: 'Sa', long: 'Samstag' },
	{ id: 'so', short: 'So', long: 'Sonntag' }
];

export const DEFAULT_REMIND_AT = '17:00';

/**
 * Art einer Uebung (Migration 1789822800); leer gilt als `weight`. Bei `time`
 * stehen in `reps`/`reps_max` Sekunden statt Wiederholungen.
 */
export const KINDS = [
	{ id: 'weight', label: 'Gewicht' },
	{ id: 'bodyweight', label: 'Körpergewicht' },
	{ id: 'time', label: 'Zeit' }
];
/** Satzpause in Sekunden, wenn eine Uebung neu angelegt wird. */
export const DEFAULT_REST = 90;
/** Steigerung in kg, wenn eine Uebung neu angelegt wird. */
export const DEFAULT_INCREMENT = 2.5;
/** Hoechstzahl Saetze pro Uebung und Tag -- wie SETS_MAX in pb_hooks/training-lib.js. */
export const SETS_MAX = 30;
export const NOTE_MAX = 500;

export const training = $state({
	plan: null,
	workouts: [],
	exercises: [],
	logs: [],
	sessions: [],
	loading: true,
	error: null
});

// Kein $state: nur Steuerung, siehe CLAUDE.md zu $effect-Schleifen.
let loadedFor = '';

/** Heute als "YYYY-MM-DD" in der Zeit des Geraets. */
export function today() {
	const d = new Date();
	const pad = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "2026-10-02" -> "Fr, 02.10." */
export function formatDate(date) {
	const [y, m, d] = String(date).split('-').map(Number);
	if (!y || !m || !d) return String(date);
	const weekday = new Date(y, m - 1, d).toLocaleDateString('de-DE', { weekday: 'short' });
	return `${weekday}, ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.`;
}

/** 42.5 -> "42,5 kg" */
export function formatWeight(kg) {
	return `${Number(kg).toLocaleString('de-DE', { maximumFractionDigits: 2 })} kg`;
}

/**
 * Eingabe -> Kilogramm. Leer ergibt null (= kein Eintrag), Unsinn NaN.
 * Komma und Punkt sind beide erlaubt; eine deutsche Tastatur liefert das Komma.
 */
export function parseWeight(text) {
	const t = String(text ?? '').trim().replace(',', '.');
	if (t === '') return null;
	if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
	const kg = Number(t);
	return kg > 1000 ? NaN : kg;
}

function bySort(a, b) {
	return (a.sort ?? 0) - (b.sort ?? 0) || String(a.created).localeCompare(String(b.created));
}

/** Die Trainings in der Reihenfolge der Einstellungen (Kopie). */
export function orderedWorkouts() {
	return [...training.workouts].sort(bySort);
}

/** Die Uebungen eines Trainings in ihrer Reihenfolge (Kopie). */
export function exercisesOf(workoutId) {
	return training.exercises.filter((e) => e.workout === workoutId).sort(bySort);
}

/** Lesbare Meldung eines PocketBase-Fehlers, bevorzugt die des ersten Feldes. */
export function trainingError(err, fallback) {
	const data = err?.response?.data ?? {};
	if (data.name?.code === 'validation_not_unique') return 'Diesen Namen gibt es schon.';
	const first = Object.values(data).find((v) => v?.message);
	return first?.message ?? err?.message ?? fallback;
}

/**
 * Laedt Plan, Trainings, Uebungen und Verlauf. Aufruf aus einem $effect heraus;
 * der Rueckgabewert ist das Teardown.
 */
export function syncTraining(userId) {
	let cancelled = false;
	if (loadedFor !== userId) {
		training.plan = null;
		training.workouts = [];
		training.exercises = [];
		training.logs = [];
		training.sessions = [];
	}
	training.loading = loadedFor !== userId;
	training.error = null;
	const filter = pb.filter('user = {:u}', { u: userId });

	Promise.all([
		pb.collection('training_plans').getFullList({ filter }),
		pb.collection('training_workouts').getFullList({ filter }),
		pb.collection('training_exercises').getFullList({ filter }),
		// Der Verlauf waechst mit jedem Training; ein Jahr bei 3 x 6 Uebungen
		// sind knapp 1000 Zeilen. Fuer "Letztes Mal" und den Vorschlag reicht das;
		// der ganze Verlauf einer Uebung kommt aus loadExerciseLogs().
		pb.collection('training_logs').getList(1, 1000, { filter, sort: '-date' }),
		pb.collection('training_sessions').getList(1, 100, { filter, sort: '-date' })
	])
		.then(([plans, workouts, exercises, logs, sessions]) => {
			if (cancelled) return;
			training.plan = plans[0] ?? null;
			training.workouts = workouts;
			training.exercises = exercises;
			training.logs = logs.items;
			training.sessions = sessions.items;
			training.loading = false;
			loadedFor = userId;
		})
		.catch((err) => {
			if (cancelled) return;
			training.error = trainingError(err, 'Training konnte nicht geladen werden.');
			training.loading = false;
		});

	return () => {
		cancelled = true;
	};
}

function me() {
	const record = pb.authStore.record;
	if (!record) throw new Error('Nicht angemeldet');
	return record;
}

function nextSort(list) {
	return Math.max(-1, ...list.map((r) => r.sort ?? 0)) + 1;
}

/**
 * Einen Datensatz in `ordered` um `delta` Plaetze verschieben. Nummeriert dabei
 * alle neu, deren Platz nicht zu `sort` passt -- sonst bliebe ein Gleichstand
 * ein Gleichstand.
 */
async function move(collection, ordered, record, delta) {
	const from = ordered.findIndex((r) => r.id === record.id);
	const to = from + delta;
	if (from === -1 || to < 0 || to >= ordered.length) return;
	[ordered[from], ordered[to]] = [ordered[to], ordered[from]];

	// Die Kopien aus orderedWorkouts()/exercisesOf() enthalten dieselben
	// $state-Proxys wie die Liste; `r.sort = …` aendert also den Store.
	const changes = ordered
		.map((r, sort) => ({ r, sort, before: r.sort }))
		.filter(({ r, sort }) => r.sort !== sort);
	for (const { r, sort } of changes) r.sort = sort;

	const results = await Promise.allSettled(
		changes.map(({ r, sort }) => pb.collection(collection).update(r.id, { sort }))
	);
	const failed = results.findIndex((res) => res.status === 'rejected');
	if (failed === -1) return;
	results.forEach((res, i) => {
		if (res.status === 'rejected') changes[i].r.sort = changes[i].before;
	});
	throw results[failed].reason;
}

// --- Trainingstage ----------------------------------------------------------

/** Trainingstage und Uhrzeit der Erinnerung speichern. */
export async function savePlan(days, remindAt) {
	const data = { days, remind_at: remindAt };
	training.plan = training.plan
		? await pb.collection('training_plans').update(training.plan.id, data)
		: await pb.collection('training_plans').create({ ...data, user: me().id });
}

// --- Trainings --------------------------------------------------------------

export async function addWorkout(name) {
	const record = await pb
		.collection('training_workouts')
		.create({ user: me().id, name: name.trim(), sort: nextSort(training.workouts) });
	if (!training.workouts.some((w) => w.id === record.id)) training.workouts.push(record);
	return record;
}

export async function renameWorkout(workout, name) {
	const record = await pb.collection('training_workouts').update(workout.id, { name: name.trim() });
	const idx = training.workouts.findIndex((w) => w.id === workout.id);
	if (idx > -1) training.workouts[idx] = record;
}

/** Loescht das Training samt Uebungen und Verlauf (cascadeDelete). */
export async function deleteWorkout(workout) {
	await pb.collection('training_workouts').delete(workout.id);
	const gone = new Set(training.exercises.filter((e) => e.workout === workout.id).map((e) => e.id));
	for (let i = training.logs.length - 1; i >= 0; i--) {
		if (gone.has(training.logs[i].exercise)) training.logs.splice(i, 1);
	}
	for (let i = training.exercises.length - 1; i >= 0; i--) {
		if (gone.has(training.exercises[i].id)) training.exercises.splice(i, 1);
	}
	const idx = training.workouts.findIndex((w) => w.id === workout.id);
	if (idx > -1) training.workouts.splice(idx, 1);
}

export function moveWorkout(workout, delta) {
	return move('training_workouts', orderedWorkouts(), workout, delta);
}

// --- Uebungen ---------------------------------------------------------------

/**
 * Die Felder einer Uebung fuer create/update. Nicht uebergebene Zusatzfelder
 * bekommen beim Anlegen die Vorgaben, beim Aendern bleiben sie unangetastet.
 */
function exerciseData(fields, defaults) {
	const data = { name: fields.name.trim(), sets: fields.sets, reps: fields.reps };
	const extra = { kind: 'weight', reps_max: 0, rest: DEFAULT_REST, increment: DEFAULT_INCREMENT };
	for (const key of Object.keys(extra)) {
		if (fields[key] !== undefined) data[key] = fields[key];
		else if (defaults) data[key] = extra[key];
	}
	return data;
}

/** `fields`: name, sets, reps und optional kind, reps_max, rest, increment. */
export async function addExercise(workoutId, fields) {
	const record = await pb.collection('training_exercises').create({
		user: me().id,
		workout: workoutId,
		...exerciseData(fields, true),
		// Neue Uebungen stehen unten in ihrem Training.
		sort: nextSort(exercisesOf(workoutId))
	});
	if (!training.exercises.some((e) => e.id === record.id)) training.exercises.push(record);
}

export async function updateExercise(exercise, fields) {
	const record = await pb
		.collection('training_exercises')
		.update(exercise.id, exerciseData(fields, false));
	const idx = training.exercises.findIndex((e) => e.id === exercise.id);
	if (idx > -1) training.exercises[idx] = record;
}

/** Loescht die Uebung samt ihrem Verlauf (cascadeDelete in der Migration). */
export async function deleteExercise(exercise) {
	await pb.collection('training_exercises').delete(exercise.id);
	const idx = training.exercises.findIndex((e) => e.id === exercise.id);
	if (idx > -1) training.exercises.splice(idx, 1);
	for (let i = training.logs.length - 1; i >= 0; i--) {
		if (training.logs[i].exercise === exercise.id) training.logs.splice(i, 1);
	}
}

export function moveExercise(exercise, delta) {
	return move('training_exercises', exercisesOf(exercise.workout), exercise, delta);
}

// --- Verlauf ----------------------------------------------------------------

/** Der Eintrag einer Uebung an einem Tag (oder undefined). */
export function logFor(exerciseId, date) {
	return training.logs.find((l) => l.exercise === exerciseId && l.date === date);
}

/**
 * Hat der Eintrag Saetze? Einer nur mit Notiz (`sets: []`) zaehlt weder als
 * "letztes Mal" noch als Trainingstag -- wie `trainedOn` in pb_hooks/training-lib.js.
 */
export function hasSets(log) {
	return !(Array.isArray(log?.sets) && log.sets.length === 0);
}

/** Der juengste Eintrag einer Uebung mit Saetzen *vor* `date` -- "letztes Mal". */
export function previousLog(exerciseId, date) {
	let best;
	for (const l of training.logs) {
		if (l.exercise !== exerciseId || l.date >= date || !hasSets(l)) continue;
		if (!best || l.date > best.date) best = l;
	}
	return best;
}

/**
 * Welches Training an `date` vorausgewaehlt ist:
 * 1. steht fuer den Tag schon etwas drin, das Training dieser Eintraege;
 * 2. sonst das nach dem zuletzt davor gemachten (Push -> Pull -> Beine -> Push);
 * 3. sonst das erste.
 * Dieselbe Reihum-Regel nennt die Erinnerung (pb_hooks/training-lib.js).
 */
export function suggestedWorkout(date) {
	const workouts = orderedWorkouts();
	if (workouts.length === 0) return null;
	const workoutOf = Object.fromEntries(training.exercises.map((e) => [e.id, e.workout]));

	let before;
	for (const l of training.logs) {
		const w = workoutOf[l.exercise];
		if (!w || !hasSets(l)) continue;
		if (l.date === date) return workouts.find((x) => x.id === w) ?? workouts[0];
		if (l.date < date && (!before || l.date > before.date)) before = { date: l.date, w };
	}
	if (!before) return workouts[0];
	const idx = workouts.findIndex((x) => x.id === before.w);
	return workouts[(idx + 1) % workouts.length];
}

/** Art einer Uebung; ein leeres Feld (Bestand) ist `weight`. */
export function kindOf(exercise) {
	return exercise?.kind || 'weight';
}

/** Obergrenze der Wdh. (bzw. Sekunden): `reps_max`, sonst das feste Soll. */
export function topReps(exercise) {
	return Math.max(exercise?.reps ?? 0, exercise?.reps_max ?? 0);
}

/** "3 × 8–12 Wdh." bzw. "3 × 30 s" */
export function targetLabel(exercise) {
	const unit = kindOf(exercise) === 'time' ? ' s' : ' Wdh.';
	const top = topReps(exercise);
	const range = top > exercise.reps ? `${exercise.reps}–${top}` : `${exercise.reps}`;
	return `${exercise.sets} × ${range}${unit}`;
}

/**
 * Die Saetze eines Eintrags: `[{ weight, reps, seconds, warmup }]`. Ein Eintrag
 * ganz ohne `sets` (vor der Migration angelegt und nicht umgeschrieben) gilt als
 * ein Satz mit seinem Gewicht; eine leere Liste ist ein Eintrag nur mit Notiz.
 */
export function setsOf(log) {
	if (!log) return [];
	if (Array.isArray(log.sets)) return log.sets;
	return [{ weight: log.weight ?? 0, reps: null, seconds: null, warmup: false }];
}

/** Nur die Arbeitssaetze (ohne Aufwaermen). */
export function workingSets(log) {
	return setsOf(log).filter((s) => !s.warmup);
}

/**
 * Kurzfassung der Arbeitssaetze fuer Verlauf und "Letztes Mal":
 * "60 kg × 8, 8, 7", bei wechselndem Gewicht "60 × 8 · 62,5 × 6",
 * bei Zeit "45 s, 40 s", bei Koerpergewicht "12, 10, 9 Wdh." (+ Zusatzgewicht).
 */
export function formatSets(exercise, log) {
	const sets = workingSets(log);
	if (sets.length === 0) return '';
	const kind = kindOf(exercise);
	const n = (v) => Number(v).toLocaleString('de-DE', { maximumFractionDigits: 2 });
	if (kind === 'time') return sets.map((s) => `${s.seconds ?? '–'} s`).join(', ');

	const weights = [...new Set(sets.map((s) => s.weight ?? 0))];
	const reps = sets.map((s) => s.reps ?? '–').join(', ');
	if (kind === 'bodyweight') {
		const extra = weights.length === 1 && weights[0] > 0 ? ` (+${n(weights[0])} kg)` : '';
		return `${reps} Wdh.${extra}`;
	}
	if (sets.every((s) => s.reps == null)) return formatWeight(log.weight ?? 0);
	if (weights.length === 1) return `${n(weights[0])} kg × ${reps}`;
	return sets.map((s) => `${n(s.weight ?? 0)} × ${s.reps ?? '–'}`).join(' · ');
}

/** Geschaetztes 1RM nach Epley ueber die Arbeitssaetze; 0 ohne verwertbaren Satz. */
export function estimate1RM(log) {
	let best = 0;
	for (const s of workingSets(log)) {
		if (!s.weight || !s.reps) continue;
		const e = s.reps === 1 ? s.weight : s.weight * (1 + s.reps / 30);
		if (e > best) best = e;
	}
	return Math.round(best * 10) / 10;
}

/** Volumen = Summe Gewicht × Wdh. der Arbeitssaetze. */
export function volumeOf(log) {
	return workingSets(log).reduce((sum, s) => sum + (s.weight ?? 0) * (s.reps ?? 0), 0);
}

/**
 * Das bisher schwerste Arbeitsgewicht einer Uebung *vor* `date` (aus den
 * geladenen Eintraegen); 0, wenn es noch keinen gibt.
 */
export function bestWeightBefore(exerciseId, date) {
	let best = 0;
	for (const l of training.logs) {
		if (l.exercise === exerciseId && l.date < date && (l.weight ?? 0) > best) best = l.weight;
	}
	return best;
}

/**
 * Steigerungsvorschlag (Double Progression): hat man beim letzten Mal in
 * mindestens `sets` Arbeitssaetzen mit gleichem Gewicht die Obergrenze an
 * Wdh. geschafft, ist `weight + increment` dran. Nur fuer `kind = weight`.
 * Liefert `{ weight, from }` oder null.
 */
export function suggestion(exercise, date) {
	if (kindOf(exercise) !== 'weight' || !exercise.increment) return null;
	const prev = previousLog(exercise.id, date);
	if (!prev || !prev.weight) return null;
	const sets = workingSets(prev).filter((s) => s.weight === prev.weight);
	const top = topReps(exercise);
	if (sets.length < exercise.sets || sets.some((s) => s.reps == null || s.reps < top)) return null;
	return { weight: Math.round((prev.weight + exercise.increment) * 100) / 100, from: prev.weight };
}

/**
 * Die Eintraege eines Trainingstags speichern. `entries` bildet Uebungs-ID auf
 * `{ sets, note }` ab; null (oder keine Saetze und keine Notiz) heisst "nicht
 * gemacht" und loescht einen vorhandenen Eintrag. Unveraenderte Eintraege
 * gehen gar nicht erst raus. `weight` leitet der Server aus `sets` ab.
 */
export async function saveDay(date, entries) {
	const user = me().id;

	const jobs = Object.entries(entries).map(async ([exercise, entry]) => {
		const existing = logFor(exercise, date);
		const sets = entry?.sets ?? [];
		const note = (entry?.note ?? '').trim();
		if (sets.length === 0 && note === '') {
			if (!existing) return;
			await pb.collection('training_logs').delete(existing.id);
			const idx = training.logs.findIndex((l) => l.id === existing.id);
			if (idx > -1) training.logs.splice(idx, 1);
		} else if (existing) {
			// Ueber die Werte, nicht ueber JSON.stringify der Objekte: der Server
			// liefert die Schluessel in anderer Reihenfolge zurueck.
			const key = (list) =>
				JSON.stringify(
					(list ?? []).map((s) => [s.weight ?? null, s.reps ?? null, s.seconds ?? null, !!s.warmup])
				);
			const same = key(existing.sets) === key(sets) && (existing.note ?? '') === note;
			if (same) return;
			const record = await pb.collection('training_logs').update(existing.id, { sets, note });
			const idx = training.logs.findIndex((l) => l.id === existing.id);
			if (idx > -1) training.logs[idx] = record;
		} else {
			const record = await pb
				.collection('training_logs')
				.create({ user, exercise, date, sets, note });
			if (!training.logs.some((l) => l.id === record.id)) training.logs.push(record);
		}
	});

	const results = await Promise.allSettled(jobs);
	const failed = results.find((r) => r.status === 'rejected');
	if (failed) throw failed.reason;
}

// `requestKey: null` bei allen Ladern unten: sie laufen parallel zu syncTraining()
// auf denselben Collections, und die Auto-Cancellation des SDK bricht sonst einen
// der beiden Requests ab ("The request was aborted").

/** Der ganze Verlauf einer Uebung, aelteste zuerst (ohne die 1000er-Grenze). */
export function loadExerciseLogs(exerciseId) {
	return pb.collection('training_logs').getFullList({
		filter: pb.filter('user = {:u} && exercise = {:e}', { u: me().id, e: exerciseId }),
		sort: 'date',
		requestKey: null
	});
}

/**
 * Wer an welchen Tagen von `from` bis `to` (je "YYYY-MM-DD", inklusive)
 * trainiert hat: `{ logs, sessions }`, die Eintraege nur mit Datum, Uebung und Saetzen.
 */
export async function loadDays(from, to) {
	const filter = pb.filter('user = {:u} && date >= {:from} && date <= {:to}', {
		u: me().id,
		from,
		to
	});
	const [logs, sessions] = await Promise.all([
		pb.collection('training_logs').getFullList({ filter, fields: 'id,date,exercise,sets', requestKey: null }),
		pb.collection('training_sessions').getFullList({ filter, requestKey: null })
	]);
	return { logs, sessions };
}

// --- Dauer ------------------------------------------------------------------

/** Der Datensatz mit der Dauer fuer `date` (oder undefined). */
export function sessionFor(date) {
	return training.sessions.find((s) => s.date === date);
}

/** "1:05:09" bzw. "12:34" */
export function formatDuration(seconds) {
	const s = Math.max(0, Math.round(seconds));
	const pad = (n) => String(n).padStart(2, '0');
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** Dauer (Sekunden) und Training eines Tages speichern; ersetzt einen alten Wert. */
export async function saveSession(date, workoutId, duration) {
	const data = { workout: workoutId ?? '', duration: Math.min(86400, Math.round(duration)) };
	// Der Store kennt nur die juengsten Sessions; eine aeltere (oder eine von einem
	// anderen Geraet) haette sonst ein create, das am Unique-Index scheitert.
	let existing = sessionFor(date);
	if (!existing) {
		existing = await pb
			.collection('training_sessions')
			.getFirstListItem(pb.filter('user = {:u} && date = {:d}', { u: me().id, d: date }), {
				requestKey: null
			})
			.catch(() => undefined);
	}
	const record = existing
		? await pb.collection('training_sessions').update(existing.id, data)
		: await pb.collection('training_sessions').create({ ...data, user: me().id, date });
	const idx = training.sessions.findIndex((s) => s.id === record.id);
	if (idx > -1) training.sessions[idx] = record;
	else training.sessions.push(record);
	return record;
}

// --- Koerpergewicht ---------------------------------------------------------

/** Alle Koerpergewichte, aelteste zuerst. */
export function loadBodyweight() {
	return pb.collection('training_bodyweight').getFullList({
		filter: pb.filter('user = {:u}', { u: me().id }),
		sort: 'date',
		requestKey: null
	});
}

/** Gewicht fuer `date` eintragen oder ersetzen; `existing` = der Datensatz des Tages. */
export function saveBodyweight(date, weight, existing) {
	return existing
		? pb.collection('training_bodyweight').update(existing.id, { weight })
		: pb.collection('training_bodyweight').create({ user: me().id, date, weight });
}

export function deleteBodyweight(record) {
	return pb.collection('training_bodyweight').delete(record.id);
}

// --- Export -----------------------------------------------------------------

function csvCell(value) {
	let s = value === null || value === undefined ? '' : String(value);
	// Text, der mit = + - @ beginnt, liest Excel als Formel. Zahlen sind
	// hier nie negativ, ein fuehrendes '-' ist also immer Text.
	if (typeof value === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`;
	return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Der ganze Verlauf als CSV (Semikolon, deutsches Dezimalkomma -- so oeffnet
 * Excel es ohne Import-Dialog): eine Zeile pro Satz.
 */
export async function exportCsv() {
	const filter = pb.filter('user = {:u}', { u: me().id });
	const [logs, bodyweight] = await Promise.all([
		pb.collection('training_logs').getFullList({ filter, sort: 'date', requestKey: null }),
		loadBodyweight()
	]);
	const exercises = Object.fromEntries(training.exercises.map((e) => [e.id, e]));
	const workouts = Object.fromEntries(training.workouts.map((w) => [w.id, w.name]));
	const dec = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));

	const rows = [['Datum', 'Training', 'Übung', 'Satz', 'Aufwärmen', 'Gewicht (kg)', 'Wdh.', 'Sekunden', 'Notiz']];
	for (const log of logs) {
		const ex = exercises[log.exercise];
		const sets = setsOf(log);
		sets.forEach((s, i) => {
			rows.push([
				log.date,
				workouts[ex?.workout] ?? '',
				ex?.name ?? '',
				i + 1,
				s.warmup ? 'ja' : '',
				dec(s.weight),
				s.reps ?? '',
				s.seconds ?? '',
				i === 0 ? (log.note ?? '') : ''
			]);
		});
	}
	for (const b of bodyweight) {
		rows.push([b.date, '', 'Körpergewicht', '', '', dec(b.weight), '', '', '']);
	}
	// BOM, damit Excel die Umlaute als UTF-8 liest.
	return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
}
