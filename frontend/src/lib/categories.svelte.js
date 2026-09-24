import { pb } from './pocketbase.svelte.js';

// Kategorien ("Wo einkaufen?") des aktiven Haushalts (Migration 1789477200).
// Gelesen von allen Mitgliedern, geaendert nur von Haupt-Mitgliedern auf der
// Seite "Haushalt-Einstellungen". `items.category` ist eine Relation hierauf.

/** Maximale Laenge eines Namens -- muss mit Migration 1789477200 uebereinstimmen. */
export const CATEGORY_MAX = 40;

/** Gruppe fuer Eintraege ohne (oder mit geloeschter) Kategorie. */
export const NO_CATEGORY = 'Ohne Kategorie';

export const categories = $state({
	list: [],
	loading: true,
	error: null
});

// Kein $state: nur Steuerung, siehe CLAUDE.md zu $effect-Schleifen.
let loadedFor = '';

function bySort(a, b) {
	return (a.sort ?? 0) - (b.sort ?? 0) || String(a.created).localeCompare(String(b.created));
}

/** Die Kategorien in der Reihenfolge des Zettels (Kopie, `list` bleibt unsortiert). */
export function orderedCategories() {
	return [...categories.list].sort(bySort);
}

/** Fehlermeldung eines Requests; der Unique-Index meldet sich am Feld `name`. */
export function categoryError(err, fallback) {
	if (err?.response?.data?.name?.code === 'validation_not_unique') {
		return 'Diese Kategorie gibt es schon.';
	}
	return err?.message ?? fallback;
}

/**
 * Laedt die Kategorien eines Haushalts und haengt die Realtime-Subscription an.
 * Aufruf aus einem $effect heraus; der Rueckgabewert ist das Teardown.
 */
export function syncCategories(householdId) {
	let cancelled = false;
	if (loadedFor !== householdId) categories.list = [];
	categories.loading = loadedFor !== householdId;
	categories.error = null;
	const filter = pb.filter('household = {:h}', { h: householdId });

	pb.collection('categories')
		.getFullList({ filter })
		.then((records) => {
			if (cancelled) return;
			categories.list = records;
			categories.loading = false;
			loadedFor = householdId;
		})
		.catch((err) => {
			if (cancelled) return;
			categories.error = err?.message ?? 'Kategorien konnten nicht geladen werden.';
			categories.loading = false;
		});

	pb.collection('categories').subscribe(
		'*',
		(e) => {
			if (e.record.household !== householdId) return;
			const list = categories.list;
			const idx = list.findIndex((c) => c.id === e.record.id);
			if (e.action === 'delete') {
				if (idx > -1) list.splice(idx, 1);
			} else if (idx > -1) {
				list[idx] = e.record;
			} else {
				list.push(e.record);
			}
		},
		{ filter }
	);

	return () => {
		cancelled = true;
		pb.collection('categories').unsubscribe('*');
	};
}

export async function addCategory(householdId, name) {
	const trimmed = name.trim();
	if (!trimmed) return;
	// Neue Kategorien stehen unten.
	const sort = Math.max(-1, ...categories.list.map((c) => c.sort ?? 0)) + 1;
	const record = await pb
		.collection('categories')
		.create({ household: householdId, name: trimmed, sort });
	if (!categories.list.some((c) => c.id === record.id)) categories.list.push(record);
}

export async function renameCategory(category, name) {
	const record = await pb.collection('categories').update(category.id, { name: name.trim() });
	const idx = categories.list.findIndex((c) => c.id === category.id);
	if (idx > -1) categories.list[idx] = record;
}

export async function deleteCategory(category) {
	const idx = categories.list.findIndex((c) => c.id === category.id);
	const removed = idx > -1 ? categories.list.splice(idx, 1)[0] : null;
	try {
		await pb.collection('categories').delete(category.id);
	} catch (err) {
		if (removed && !categories.list.some((c) => c.id === removed.id)) {
			categories.list.splice(idx, 0, removed);
		}
		throw err;
	}
}

/**
 * Eine Kategorie um `delta` Plaetze verschieben. Nummeriert dabei alle neu,
 * deren Platz nicht zu `sort` passt -- sonst blieben gleiche `sort`-Werte
 * (Gleichstand) nach dem Tausch gleich und es bewegte sich nichts.
 */
export async function moveCategory(category, delta) {
	const ordered = orderedCategories();
	const from = ordered.findIndex((c) => c.id === category.id);
	const to = from + delta;
	if (from === -1 || to < 0 || to >= ordered.length) return;
	[ordered[from], ordered[to]] = [ordered[to], ordered[from]];

	const changes = ordered
		.map((c, sort) => ({ c, sort, before: c.sort }))
		.filter(({ c, sort }) => c.sort !== sort);
	for (const { c, sort } of changes) c.sort = sort;

	// Nur zuruecksetzen, was nicht gespeichert wurde -- der Rest steht so auf dem Server.
	const results = await Promise.allSettled(
		changes.map(({ c, sort }) => pb.collection('categories').update(c.id, { sort }))
	);
	const failed = results.findIndex((r) => r.status === 'rejected');
	if (failed === -1) return;
	results.forEach((r, i) => {
		if (r.status === 'rejected') changes[i].c.sort = changes[i].before;
	});
	throw results[failed].reason;
}
