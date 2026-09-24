import { pb } from './pocketbase.svelte.js';
import { maybeFly } from './easteregg.svelte.js';
import { households } from './households.svelte.js';

// Relations mitladen, sonst steht in der Zeile nur eine Record-ID.
const EXPAND = 'added_by,done_by';

/**
 * Anzeigename eines expandierten Users; leer, wenn die Relation nicht gesetzt ist.
 * `name` ist fuer alle sichtbar, `email` nur bei `emailVisibility` bzw. beim eigenen
 * Record -- ohne Fallback stuende bei fremden Accounts ohne Namen gar nichts da.
 */
export function userLabel(user) {
	if (!user) return '';
	return user.name || user.email?.split('@')[0] || 'Jemand';
}

/** PocketBase-Zeitstempel ("2026-09-03 19:41:30.123Z") zu einem Date; null wenn unbrauchbar. */
function parseStamp(value) {
	if (!value) return null;
	// Ohne das "T" liest Safari den Zeitstempel nicht.
	const date = new Date(String(value).replace(' ', 'T'));
	return Number.isNaN(date.getTime()) ? null : date;
}

/** Nur der Tag, ausgeschrieben -- fuer Angaben, bei denen die Uhrzeit belanglos ist. */
export function formatDate(value) {
	const date = parseStamp(value);
	if (!date) return '';
	return date.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Zeitstempel kurz und deutsch, mit Uhrzeit ("heute 19:41", "3. Sep 19:41"). */
export function formatWhen(value) {
	const date = parseStamp(value);
	if (!date) return '';

	const today = new Date();
	const sameDay =
		date.getFullYear() === today.getFullYear() &&
		date.getMonth() === today.getMonth() &&
		date.getDate() === today.getDate();

	const time = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
	if (sameDay) return `heute ${time}`;

	const sameYear = date.getFullYear() === today.getFullYear();
	const day = date.toLocaleDateString('de-DE', {
		day: 'numeric',
		month: 'short',
		year: sameYear ? undefined : 'numeric'
	});
	return `${day} ${time}`;
}

// Ein einziges reaktives Objekt. Bewusst ein Objekt statt eines exportierten
// `let`, weil Svelte 5 den Re-Export einer neu zugewiesenen $state-Variablen
// nicht erlaubt -- und weil so ausschliesslich einzelne Items mutiert werden.
export const store = $state({
	items: [],
	loading: true,
	error: null
});

// Bewusst *kein* $state: syncItems() laeuft in einem $effect, und jeder reaktive
// Lesezugriff dort macht den Effekt von dem abhaengig, was sein eigener
// Ladevorgang anschliessend schreibt -- Endlosschleife aus Request und Neustart.
// Haelt den Haushalt, dessen Liste zuletzt geladen wurde.
let loadedFor = '';

/**
 * Laedt die Liste eines Haushalts und haengt die Realtime-Subscription an.
 * Aufruf aus einem $effect heraus; der Rueckgabewert ist das Teardown.
 */
export function syncItems(householdId) {
	let cancelled = false;
	// Nur beim ersten Laden "Lade …" zeigen: beim Zurueckkehren von einer anderen
	// Seite stehen die Eintraege noch da und wuerden sonst kurz nach unten springen.
	// Nach einem Wechsel des Haushalts gehoeren sie aber nicht mehr hierher.
	if (loadedFor !== householdId) store.items = [];
	store.loading = loadedFor !== householdId;
	store.error = null;
	const filter = pb.filter('household = {:h}', { h: householdId });

	pb.collection('items')
		.getFullList({ sort: 'created', expand: EXPAND, filter })
		.then((records) => {
			if (cancelled) return;
			store.items = records;
			store.loading = false;
			loadedFor = householdId;
		})
		.catch((err) => {
			if (cancelled) return;
			store.error = err?.message ?? 'Laden fehlgeschlagen';
			store.loading = false;
		});

	// Der Filter spart die Events der anderen Haushalte, in denen man Gast ist;
	// die Pruefung im Callback haelt, falls ein Event trotzdem durchkommt.
	pb.collection('items').subscribe('*', (e) => {
		if (e.record.household !== householdId) return;
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
	}, { expand: EXPAND, filter });

	return () => {
		cancelled = true;
		pb.collection('items').unsubscribe('*');
	};
}

/** `category` ist die ID einer Kategorie des aktiven Haushalts; leer = ohne. */
export async function addItem(name, category = '') {
	const trimmed = name.trim();
	if (!trimmed) return;

	const record = await pb.collection('items').create(
		{
			name: trimmed,
			category: category || '',
			done: false,
			added_by: pb.authStore.record?.id ?? '',
			household: households.activeId
		},
		{ expand: EXPAND }
	);

	if (!store.items.some((i) => i.id === record.id)) store.items.push(record);

	// Osterei: nur beim Anlegenden, nicht ueber die Realtime-Subscription -- sonst
	// wuerfelt jedes Geraet fuer denselben Eintrag noch einmal mit.
	maybeFly();
}

export async function toggleItem(item) {
	const me = pb.authStore.record ?? null;
	if (!me) return; // ohne Auth wuerde der Request ohnehin scheitern
	const before = { done: item.done, done_by: item.done_by, expand: item.expand };
	const done = !item.done;

	// Optimistisch: erst lokal, dann Server. Der eigene User steht schon im
	// authStore, also kann auch der Name sofort stehen.
	item.done = done;
	item.done_by = done ? me.id : '';
	item.expand = { ...(item.expand ?? {}), done_by: done ? me : undefined };

	try {
		const record = await pb.collection('items').update(
			item.id,
			{ done: item.done, done_by: item.done_by },
			{ expand: EXPAND }
		);
		item.expand = record.expand ?? {};
	} catch (err) {
		item.done = before.done;
		item.done_by = before.done_by;
		item.expand = before.expand;
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

/** Maximale Laenge von `note` -- muss mit Migration 1756000006 uebereinstimmen. */
export const NOTE_MAX = 2000;

/**
 * Ein einzelnes Item vom Server holen. Die Detailseite kann nicht aus `store`
 * lesen: wird sie direkt geladen (Reload, Lesezeichen), lief syncItems() nie.
 */
export function loadItem(id) {
	return pb.collection('items').getOne(id, { expand: EXPAND });
}

/**
 * Titel und Beschreibung speichern. Aktualisiert den Store gleich mit, damit
 * die Liste beim Zurueckgehen nicht erst auf das Realtime-Event warten muss --
 * beim Verlassen der Listenseite ist die Subscription abgemeldet.
 */
export async function saveItemDetails(id, { name, note }) {
	const record = await pb.collection('items').update(
		id,
		{ name: name.trim(), note: note.trim() },
		{ expand: EXPAND }
	);

	const idx = store.items.findIndex((i) => i.id === id);
	if (idx > -1) store.items[idx] = record;

	return record;
}
