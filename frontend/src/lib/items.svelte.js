import { pb } from './pocketbase.svelte.js';

export const CATEGORIES = [
	'Obst/Gemüse',
	'Kühlregal',
	'Trocken',
	'Getränke',
	'Drogerie',
	'Sonstiges'
];

export const DEFAULT_CATEGORY = 'Sonstiges';

// Ein einziges reaktives Objekt. Bewusst ein Objekt statt eines exportierten
// `let`, weil Svelte 5 den Re-Export einer neu zugewiesenen $state-Variablen
// nicht erlaubt -- und weil so ausschliesslich einzelne Items mutiert werden.
export const store = $state({
	items: [],
	loading: true,
	error: null
});

/**
 * Laedt die Liste und haengt die Realtime-Subscription an.
 * Aufruf aus einem $effect heraus; der Rueckgabewert ist das Teardown.
 */
export function syncItems() {
	let cancelled = false;
	store.loading = true;
	store.error = null;

	pb.collection('items')
		.getFullList({ sort: 'created' })
		.then((records) => {
			if (cancelled) return;
			store.items = records;
			store.loading = false;
		})
		.catch((err) => {
			if (cancelled) return;
			store.error = err?.message ?? 'Laden fehlgeschlagen';
			store.loading = false;
		});

	pb.collection('items').subscribe('*', (e) => {
		const items = store.items;
		const idx = items.findIndex((x) => x.id === e.record.id);

		if (e.action === 'create') {
			// idx > -1 heisst: wir haben das Item lokal schon optimistisch eingefuegt.
			if (idx === -1) items.push(e.record);
			else items[idx] = e.record;
		} else if (e.action === 'update') {
			if (idx > -1) items[idx] = e.record;
			else items.push(e.record);
		} else if (e.action === 'delete') {
			if (idx > -1) items.splice(idx, 1);
		}
	});

	return () => {
		cancelled = true;
		pb.collection('items').unsubscribe('*');
	};
}

export async function addItem(name, category = DEFAULT_CATEGORY) {
	const trimmed = name.trim();
	if (!trimmed) return;

	const record = await pb.collection('items').create({
		name: trimmed,
		category: category || DEFAULT_CATEGORY,
		done: false,
		added_by: pb.authStore.record?.id ?? ''
	});

	if (!store.items.some((i) => i.id === record.id)) store.items.push(record);
}

export async function toggleItem(item) {
	const before = { done: item.done, done_by: item.done_by };
	const done = !item.done;

	// Optimistisch: erst lokal, dann Server.
	item.done = done;
	item.done_by = done ? (pb.authStore.record?.id ?? '') : '';

	try {
		await pb.collection('items').update(item.id, {
			done: item.done,
			done_by: item.done_by
		});
	} catch (err) {
		item.done = before.done;
		item.done_by = before.done_by;
		store.error = err?.message ?? 'Speichern fehlgeschlagen';
	}
}

export async function deleteItem(item) {
	const idx = store.items.findIndex((i) => i.id === item.id);
	const removed = idx > -1 ? store.items.splice(idx, 1)[0] : null;

	try {
		await pb.collection('items').delete(item.id);
	} catch (err) {
		if (removed && !store.items.some((i) => i.id === removed.id)) {
			store.items.splice(idx, 0, removed);
		}
		store.error = err?.message ?? 'Löschen fehlgeschlagen';
	}
}

export async function clearDone() {
	const done = store.items.filter((i) => i.done);
	for (const item of done) {
		await deleteItem(item);
	}
}
