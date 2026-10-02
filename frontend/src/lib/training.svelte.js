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

export const training = $state({
	plan: null,
	workouts: [],
	exercises: [],
	logs: [],
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
	}
	training.loading = loadedFor !== userId;
	training.error = null;
	const filter = pb.filter('user = {:u}', { u: userId });

	Promise.all([
		pb.collection('training_plans').getFullList({ filter }),
		pb.collection('training_workouts').getFullList({ filter }),
		pb.collection('training_exercises').getFullList({ filter }),
		// Der Verlauf waechst mit jedem Training; ein Jahr bei 3 x 6 Uebungen
		// sind knapp 1000 Zeilen.
		pb.collection('training_logs').getList(1, 1000, { filter, sort: '-date' })
	])
		.then(([plans, workouts, exercises, logs]) => {
			if (cancelled) return;
			training.plan = plans[0] ?? null;
			training.workouts = workouts;
			training.exercises = exercises;
			training.logs = logs.items;
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

export async function addExercise(workoutId, { name, sets, reps }) {
	const record = await pb.collection('training_exercises').create({
		user: me().id,
		workout: workoutId,
		name: name.trim(),
		sets,
		reps,
		// Neue Uebungen stehen unten in ihrem Training.
		sort: nextSort(exercisesOf(workoutId))
	});
	if (!training.exercises.some((e) => e.id === record.id)) training.exercises.push(record);
}

export async function updateExercise(exercise, { name, sets, reps }) {
	const record = await pb
		.collection('training_exercises')
		.update(exercise.id, { name: name.trim(), sets, reps });
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

/** Der juengste Eintrag einer Uebung *vor* `date` -- "letztes Mal". */
export function previousLog(exerciseId, date) {
	let best;
	for (const l of training.logs) {
		if (l.exercise !== exerciseId || l.date >= date) continue;
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
		if (!w) continue;
		if (l.date === date) return workouts.find((x) => x.id === w) ?? workouts[0];
		if (l.date < date && (!before || l.date > before.date)) before = { date: l.date, w };
	}
	if (!before) return workouts[0];
	const idx = workouts.findIndex((x) => x.id === before.w);
	return workouts[(idx + 1) % workouts.length];
}

/**
 * Die Gewichte eines Trainingstags speichern. `weights` bildet Uebungs-ID auf
 * Kilogramm ab; null heisst "nicht gemacht" und loescht einen vorhandenen
 * Eintrag. Unveraenderte Werte gehen gar nicht erst raus.
 */
export async function saveDay(date, weights) {
	const user = me().id;

	const jobs = Object.entries(weights).map(async ([exercise, weight]) => {
		const existing = logFor(exercise, date);
		if (weight === null) {
			if (!existing) return;
			await pb.collection('training_logs').delete(existing.id);
			const idx = training.logs.findIndex((l) => l.id === existing.id);
			if (idx > -1) training.logs.splice(idx, 1);
		} else if (existing) {
			if (existing.weight === weight) return;
			const record = await pb.collection('training_logs').update(existing.id, { weight });
			const idx = training.logs.findIndex((l) => l.id === existing.id);
			if (idx > -1) training.logs[idx] = record;
		} else {
			const record = await pb.collection('training_logs').create({ user, exercise, date, weight });
			if (!training.logs.some((l) => l.id === record.id)) training.logs.push(record);
		}
	});

	const results = await Promise.allSettled(jobs);
	const failed = results.find((r) => r.status === 'rejected');
	if (failed) throw failed.reason;
}
