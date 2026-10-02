import { pb } from './pocketbase.svelte.js';

// Trainingsplan der angemeldeten Person (Migration 1789563600). Privat: weder
// der Haushalt noch sonst jemand sieht ihn. Daher auch keine Realtime -- es
// schreibt niemand ausser einem selbst.

/** Maximale Laenge eines Uebungsnamens -- muss mit der Migration uebereinstimmen. */
export const EXERCISE_MAX = 60;

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

/** Die Uebungen in der Reihenfolge des Plans (Kopie). */
export function orderedExercises() {
	return [...training.exercises].sort(bySort);
}

/** Lesbare Meldung eines PocketBase-Fehlers, bevorzugt die des ersten Feldes. */
export function trainingError(err, fallback) {
	const data = err?.response?.data ?? {};
	const first = Object.values(data).find((v) => v?.message);
	return first?.message ?? err?.message ?? fallback;
}

/**
 * Laedt Plan, Uebungen und Verlauf. Aufruf aus einem $effect heraus; der
 * Rueckgabewert ist das Teardown.
 */
export function syncTraining(userId) {
	let cancelled = false;
	if (loadedFor !== userId) {
		training.plan = null;
		training.exercises = [];
		training.logs = [];
	}
	training.loading = loadedFor !== userId;
	training.error = null;
	const filter = pb.filter('user = {:u}', { u: userId });

	Promise.all([
		pb.collection('training_plans').getFullList({ filter }),
		pb.collection('training_exercises').getFullList({ filter }),
		// Der Verlauf waechst mit jedem Training; ein Jahr bei 3 x 6 Uebungen
		// sind knapp 1000 Zeilen.
		pb.collection('training_logs').getList(1, 1000, { filter, sort: '-date' })
	])
		.then(([plans, exercises, logs]) => {
			if (cancelled) return;
			training.plan = plans[0] ?? null;
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

/** Trainingstage und Uhrzeit der Erinnerung speichern. */
export async function savePlan(days, remindAt) {
	const me = pb.authStore.record;
	if (!me) throw new Error('Nicht angemeldet');
	const data = { days, remind_at: remindAt };
	training.plan = training.plan
		? await pb.collection('training_plans').update(training.plan.id, data)
		: await pb.collection('training_plans').create({ ...data, user: me.id });
}

export async function addExercise({ name, sets, reps }) {
	const me = pb.authStore.record;
	if (!me) throw new Error('Nicht angemeldet');
	// Neue Uebungen stehen unten.
	const sort = Math.max(-1, ...training.exercises.map((e) => e.sort ?? 0)) + 1;
	const record = await pb
		.collection('training_exercises')
		.create({ user: me.id, name: name.trim(), sets, reps, sort });
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

/**
 * Eine Uebung um `delta` Plaetze verschieben. Nummeriert dabei alle neu, deren
 * Platz nicht zu `sort` passt -- sonst bliebe ein Gleichstand ein Gleichstand.
 */
export async function moveExercise(exercise, delta) {
	const ordered = orderedExercises();
	const from = ordered.findIndex((e) => e.id === exercise.id);
	const to = from + delta;
	if (from === -1 || to < 0 || to >= ordered.length) return;
	[ordered[from], ordered[to]] = [ordered[to], ordered[from]];

	const changes = ordered
		.map((e, sort) => ({ e, sort, before: e.sort }))
		.filter(({ e, sort }) => e.sort !== sort);
	for (const { e, sort } of changes) e.sort = sort;

	const results = await Promise.allSettled(
		changes.map(({ e, sort }) => pb.collection('training_exercises').update(e.id, { sort }))
	);
	const failed = results.findIndex((r) => r.status === 'rejected');
	if (failed === -1) return;
	results.forEach((r, i) => {
		if (r.status === 'rejected') changes[i].e.sort = changes[i].before;
	});
	throw results[failed].reason;
}

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
 * Die Gewichte eines Trainingstags speichern. `weights` bildet Uebungs-ID auf
 * Kilogramm ab; null heisst "nicht gemacht" und loescht einen vorhandenen
 * Eintrag. Unveraenderte Werte gehen gar nicht erst raus.
 */
export async function saveDay(date, weights) {
	const me = pb.authStore.record;
	if (!me) throw new Error('Nicht angemeldet');

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
			const record = await pb
				.collection('training_logs')
				.create({ user: me.id, exercise, date, weight });
			if (!training.logs.some((l) => l.id === record.id)) training.logs.push(record);
		}
	});

	const results = await Promise.allSettled(jobs);
	const failed = results.find((r) => r.status === 'rejected');
	if (failed) throw failed.reason;
}
