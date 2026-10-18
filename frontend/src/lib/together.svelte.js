import { pb } from './pocketbase.svelte.js';

// "Muessen wir mal machen": gemeinsame Vorhaben, fuer alle oder fuer einen
// Haushalt. Collections aus Migration 1790082000, Schreibrechte im Detail in
// pb_hooks/together.pb.js.
const COLLECTION = 'together';
const COMMENTS = 'together_comments';

// Ohne expand stehen in den Relationen nur Record-IDs statt Namen.
const EXPAND = 'author,interested,done_by';
const COMMENT_EXPAND = 'author';

/** Maximale Laengen -- muessen mit der Migration uebereinstimmen. */
export const TITLE_MAX = 200;
export const NOTE_MAX = 2000;
export const COMMENT_MAX = 1000;

/** Arten -- `id` muss mit KINDS in der Migration uebereinstimmen. */
export const KINDS = [
	{ id: 'essen', label: 'Café & Essen', emoji: '☕' },
	{ id: 'ausflug', label: 'Ausflug & Wandern', emoji: '🥾' },
	{ id: 'film', label: 'Film & Serie', emoji: '🎬' },
	{ id: 'rezept', label: 'Rezept', emoji: '🍳' },
	{ id: 'event', label: 'Konzert & Event', emoji: '🎟️' },
	{ id: 'sonstiges', label: 'Sonstiges', emoji: '✨' }
];

/** Die Art zu einer ID; Unbekanntes faellt auf "Sonstiges". */
export function kindOf(id) {
	return KINDS.find((k) => k.id === id) ?? KINDS[KINDS.length - 1];
}

/** Haben wir es gemacht? */
export function isDone(entry) {
	return Boolean(entry?.done_at);
}

/** Ist `userId` dabei? */
export function isInterested(entry, userId) {
	return Boolean(userId) && (entry?.interested ?? []).includes(userId);
}

/** Darf `userId` Termin und "gemacht" setzen? Dieselbe Regel wie der Hook. */
export function canPlan(entry, userId) {
	return Boolean(userId) && (entry?.author === userId || isInterested(entry, userId));
}

/** Heute als "YYYY-MM-DD" in lokaler Zeit. */
export function todayIso() {
	const d = new Date();
	const pad = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/**
 * "2026-10-24T14:00" -> "Sa 24.10. · 14:00", mit "heute"/"morgen" statt
 * Wochentag. Lokale Zeit wie gespeichert, keine Zeitzonen-Rechnung.
 */
export function formatPlanned(value) {
	const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value ?? '');
	if (!m) return '';
	const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const diff = Math.round((date.getTime() - today.getTime()) / 86400000);

	let day = `${WEEKDAYS[date.getDay()]} ${m[3]}.${m[2]}.`;
	if (diff === 0) day = 'heute';
	else if (diff === 1) day = 'morgen';
	if (date.getFullYear() !== today.getFullYear()) day += m[1];
	return m[4] ? `${day} · ${m[4]}:${m[5]}` : day;
}

/**
 * Teilt in drei Gruppen. Liefert Kopien -- `together.items` selbst bleibt
 * unsortiert, damit Realtime weiter einzelne Eintraege ersetzen kann.
 *
 * * planned: Termin steht, noch nicht gemacht -- naechster zuerst
 * * open: ohne Termin -- die mit den meisten Interessierten oben, dann neuste
 * * done: gemacht -- zuletzt gemacht zuerst
 */
export function groupEntries(items) {
	const planned = [];
	const open = [];
	const done = [];
	for (const entry of items) {
		if (isDone(entry)) done.push(entry);
		else if (entry.planned_at) planned.push(entry);
		else open.push(entry);
	}
	planned.sort((a, b) => a.planned_at.localeCompare(b.planned_at));
	open.sort(
		(a, b) =>
			(b.interested?.length ?? 0) - (a.interested?.length ?? 0) ||
			(b.created ?? '').localeCompare(a.created ?? '')
	);
	done.sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? ''));
	return { planned, open, done };
}

/**
 * Zufallsvorschlag fuer "Was machen wir heute?": unter den offenen und
 * geplanten Eintraegen, bei denen ich dabei bin; gibt es keinen, unter allen
 * offenen. `kind` leer = jede Art.
 */
export function pickRandom(items, userId, kind) {
	const pool = items.filter((e) => !isDone(e) && (!kind || e.kind === kind));
	const mine = pool.filter((e) => isInterested(e, userId));
	const from = mine.length > 0 ? mine : pool;
	if (from.length === 0) return null;
	return from[Math.floor(Math.random() * from.length)];
}

export const together = $state({
	items: [],
	loading: true,
	error: null
});

// Bewusst *kein* $state: syncTogether() laeuft in einem $effect, und ein
// reaktiver Lesezugriff dort haengt den Effekt an das, was sein eigener
// Ladevorgang anschliessend schreibt -- Endlosschleife (CLAUDE.md).
let loadedOnce = false;

/** Ersetzt den Eintrag in der Liste, falls er dort steht. */
function replaceInStore(record) {
	const idx = together.items.findIndex((x) => x.id === record.id);
	if (idx > -1) together.items[idx] = record;
}

/**
 * Laedt alle sichtbaren Eintraege und haengt die Realtime-Subscription an.
 * Welche das sind (fuer alle + eigene Haushalte), entscheidet die ListRule --
 * auch fuer die Realtime-Events. Aufruf aus einem $effect; der Rueckgabewert
 * ist das Teardown.
 */
export function syncTogether() {
	let cancelled = false;
	together.loading = !loadedOnce;
	together.error = null;

	pb.collection(COLLECTION)
		.getFullList({ sort: '-created', expand: EXPAND })
		.then((records) => {
			if (cancelled) return;
			together.items = records;
			together.loading = false;
			loadedOnce = true;
		})
		.catch((err) => {
			if (cancelled) return;
			together.error = err?.message ?? 'Laden fehlgeschlagen';
			together.loading = false;
		});

	// Das expand gehoert als drittes Argument dazu, sonst fehlen die Namen
	// genau bei den Eintraegen, die ueber Realtime hereinkommen.
	const unsubscribe = pb.collection(COLLECTION).subscribe(
		'*',
		(e) => {
			const items = together.items;
			const idx = items.findIndex((x) => x.id === e.record.id);
			if (e.action === 'create' || e.action === 'update') {
				if (idx > -1) items[idx] = e.record;
				else items.unshift(e.record);
			} else if (e.action === 'delete') {
				if (idx > -1) items.splice(idx, 1);
			}
		},
		{ expand: EXPAND }
	);

	return () => {
		cancelled = true;
		// Nur die eigene Subscription loesen, nicht alle auf '*' -- die
		// Detailseite haengt mit eigenen am selben Topic.
		unsubscribe.then((off) => off()).catch(() => {});
	};
}

/**
 * Neuer Eintrag. `household` leer = fuer alle. Wirft bei einem Fehler weiter
 * -- die Seite behaelt dann den Entwurf.
 */
export async function addEntry({ title, kind, household }) {
	const trimmed = title.trim();
	if (!trimmed) return null;

	const record = await pb.collection(COLLECTION).create(
		{
			title: trimmed,
			kind,
			household: household || '',
			// Die CreateRule verlangt `author = @request.auth.id` -- das Feld muss
			// aus dem Request kommen (docs/pitfalls/pocketbase-hooks.md).
			author: pb.authStore.record?.id ?? ''
		},
		{ expand: EXPAND }
	);

	// Derselbe Record kommt gleich noch ueber die Subscription.
	if (!together.items.some((i) => i.id === record.id)) together.items.unshift(record);
	return record;
}

/** Ein Eintrag fuer die Detailseite. */
export function loadEntry(id) {
	return pb.collection(COLLECTION).getOne(id, { expand: EXPAND });
}

/**
 * Realtime fuer *einen* Eintrag. `onEvent(action, record)`; liefert das
 * Teardown.
 */
export function watchEntry(id, onEvent) {
	const unsubscribe = pb
		.collection(COLLECTION)
		.subscribe(id, (e) => onEvent(e.action, e.record), { expand: EXPAND });
	return () => unsubscribe.then((off) => off()).catch(() => {});
}

/** Felder aendern (Autor: Titel, Art, Notiz, Link, Sichtbarkeit). Wirft weiter. */
export async function updateEntry(entry, data) {
	const record = await pb.collection(COLLECTION).update(entry.id, data, { expand: EXPAND });
	replaceInStore(record);
	return record;
}

/** Eintrag loeschen (nur der Autor). Wirft weiter. */
export async function deleteEntry(entry) {
	await pb.collection(COLLECTION).delete(entry.id);
	const idx = together.items.findIndex((x) => x.id === entry.id);
	if (idx > -1) together.items.splice(idx, 1);
}

/**
 * "Bin dabei" setzen oder zuruecknehmen. Optimistisch, mit Rollback.
 * Geschickt wird nur der Modifier, nie die ganze Liste -- ein gleichzeitiger
 * Klick von jemand anderem geht so nicht verloren. Wirft nicht; der Fehler
 * steht danach in `together.error`.
 */
export async function toggleInterested(entry) {
	const me = pb.authStore.record;
	if (!me) return;

	const before = { interested: entry.interested ?? [], expand: entry.expand };
	const joined = before.interested.includes(me.id);
	const people = entry.expand?.interested ?? [];

	entry.interested = joined
		? before.interested.filter((id) => id !== me.id)
		: [...before.interested, me.id];
	entry.expand = {
		...(entry.expand ?? {}),
		interested: joined ? people.filter((u) => u.id !== me.id) : [...people, me]
	};

	try {
		const record = await pb
			.collection(COLLECTION)
			.update(entry.id, { [joined ? 'interested-' : 'interested+']: me.id }, { expand: EXPAND });
		entry.interested = record.interested;
		entry.expand = record.expand ?? {};
		replaceInStore(record);
	} catch (err) {
		entry.interested = before.interested;
		entry.expand = before.expand;
		together.error = err?.message ?? 'Speichern fehlgeschlagen';
	}
}

/** Termin setzen ("YYYY-MM-DD" oder "YYYY-MM-DDTHH:MM") oder entfernen (""). Wirft weiter. */
export function setPlanned(entry, value) {
	return updateEntry(entry, { planned_at: value });
}

/** Als gemacht markieren oder wieder oeffnen. Wirft weiter. */
export function setDone(entry, done) {
	const me = pb.authStore.record?.id ?? '';
	return updateEntry(entry, {
		done_at: done ? new Date().toISOString() : '',
		done_by: done ? me : ''
	});
}

/** Kommentare eines Eintrags, aelteste zuerst. */
export function loadComments(entryId) {
	return pb.collection(COMMENTS).getFullList({
		filter: pb.filter('entry = {:id}', { id: entryId }),
		sort: 'created',
		expand: COMMENT_EXPAND
	});
}

/** Realtime fuer die Kommentare eines Eintrags; liefert das Teardown. */
export function watchComments(entryId, onEvent) {
	const unsubscribe = pb.collection(COMMENTS).subscribe('*', (e) => onEvent(e.action, e.record), {
		filter: pb.filter('entry = {:id}', { id: entryId }),
		expand: COMMENT_EXPAND
	});
	return () => unsubscribe.then((off) => off()).catch(() => {});
}

/** Kommentar schreiben. Wirft weiter -- die Seite behaelt dann den Entwurf. */
export function addComment(entryId, text) {
	return pb.collection(COMMENTS).create(
		{ entry: entryId, text: text.trim(), author: pb.authStore.record?.id ?? '' },
		{ expand: COMMENT_EXPAND }
	);
}

/** Eigenen Kommentar loeschen. Wirft weiter. */
export function deleteComment(comment) {
	return pb.collection(COMMENTS).delete(comment.id);
}
