import { pb } from './pocketbase.svelte.js';
import { households } from './households.svelte.js';

// Geschenkewuensche. Collection aus Migration 1789045200.
//
// Was hier auffaellig fehlt: ein Filter auf "nicht meine". Den braucht es
// nicht -- die API-Rules der Collection liefern die eigenen Wuensche gar nicht
// aus, auch nicht ueber Realtime. Deshalb wandert auch der Rueckgabewert von
// `create()` bewusst *nicht* in `wishes.items`.
const COLLECTION = 'wishes';

// Ohne expand steht in `wisher` nur die Record-ID statt des Namens -- und ohne
// den Namen ist ein Wunschzettel wertlos.
const EXPAND = 'wisher';

/** Maximale Laenge von `text` -- muss mit der Migration uebereinstimmen. */
export const WISH_MAX = 200;

/** Maximale Laenge von `note` (Migration 1789131600). */
export const WISH_NOTE_MAX = 2000;

// Nur die Zahl der eigenen Wuensche, kein Inhalt -- mehr gibt der Server dazu
// nicht her (Route in pb_hooks/wishes.pb.js).
const MY_COUNT_URL = '/api/wishes/mine/count';

export const wishes = $state({
	items: [],
	loading: true,
	error: null,
	// Anzahl der *eigenen* Wuensche; null = noch unbekannt oder nicht abrufbar.
	mine: null
});

// Bewusst *kein* $state: syncWishes() laeuft in einem $effect, und ein reaktiver
// Lesezugriff dort haengt den Effekt an das, was sein eigener Ladevorgang
// anschliessend schreibt -- Endlosschleife aus Request und Neustart (CLAUDE.md).
// Haelt den Haushalt, dessen Wuensche zuletzt geladen wurden.
let loadedFor = '';

/**
 * Laedt die Wuensche der anderen (neuste zuerst) und haengt die
 * Realtime-Subscription an. Aufruf aus einem $effect heraus; der Rueckgabewert
 * ist das Teardown.
 */
export function syncWishes(householdId) {
	let cancelled = false;
	// Nur beim ersten Laden "Lade …": beim Zurueckkehren steht die Liste noch da.
	// Nach einem Wechsel des Haushalts gehoert sie aber nicht mehr hierher.
	if (loadedFor !== householdId) {
		wishes.items = [];
		wishes.mine = null;
	}
	wishes.loading = loadedFor !== householdId;
	wishes.error = null;
	const filter = pb.filter('household = {:h}', { h: householdId });

	pb.collection(COLLECTION)
		.getFullList({ sort: '-created', expand: EXPAND, filter })
		.then((records) => {
			if (cancelled) return;
			wishes.items = records;
			wishes.loading = false;
			loadedFor = householdId;
		})
		.catch((err) => {
			if (cancelled) return;
			wishes.error = err?.message ?? 'Laden fehlgeschlagen';
			wishes.loading = false;
		});

	// Die eigenen Wuensche kommen in keiner Liste vor, auch nicht ueber
	// Realtime -- ihre Zahl muss deshalb aus der eigenen Route kommen. Beim
	// Betreten der Seite ist sie ausserdem der einzige Moment, in dem ein
	// Wunsch von einem anderen Geraet derselben Person auffaellt.
	pb.send(MY_COUNT_URL, { method: 'GET', query: { household: householdId } })
		.then((res) => {
			if (!cancelled) wishes.mine = Number(res?.count ?? 0);
		})
		.catch(() => {
			// Fehlt die Zahl, fehlt nur sie: die Liste der anderen steht trotzdem.
			// Kein wishes.error -- eine rote Meldung waere groesser als der Verlust.
			if (!cancelled) wishes.mine = null;
		});

	// Das expand gehoert als drittes Argument dazu, sonst fehlt der Name genau
	// bei den Wuenschen, die ueber Realtime hereinkommen.
	pb.collection(COLLECTION).subscribe(
		'*',
		(e) => {
			if (e.record.household !== householdId) return;
			const items = wishes.items;
			const idx = items.findIndex((x) => x.id === e.record.id);

			if (e.action === 'create') {
				if (idx === -1) items.unshift(e.record); // neuste zuerst
				else items[idx] = e.record;
			} else if (e.action === 'update') {
				if (idx > -1) items[idx] = e.record;
				else items.unshift(e.record);
			} else if (e.action === 'delete') {
				if (idx > -1) items.splice(idx, 1);
			}
		},
		{ expand: EXPAND, filter }
	);

	return () => {
		cancelled = true;
		pb.collection(COLLECTION).unsubscribe('*');
	};
}

/**
 * Wunsch anlegen. Der eigene Wunsch taucht danach nirgends auf -- weder in
 * `wishes.items` noch beim naechsten Laden. Wirft bei einem Fehler weiter; die
 * Seite entscheidet, was sie anzeigt (und behaelt den Entwurf).
 */
export async function addWish(text, note = '') {
	const trimmed = text.trim();
	if (!trimmed) return null;

	const me = pb.authStore.record?.id ?? '';
	// Ohne eigene ID wuerde die CreateRule abweisen, und der Nutzer saehe das
	// englische „Failed to create record." des SDK statt eines Grundes.
	if (!me) throw new Error('Nicht angemeldet.');

	// `wisher` muss mit -- die CreateRule verlangt `wisher = @request.auth.id`,
	// und sie laeuft vor dem Hook, kann das Feld also nicht von ihm bekommen
	// (docs/pitfalls/pocketbase-hooks.md). Luegen bringt nichts: genau diese
	// Rule weist jeden anderen Wert ab.
	const record = await pb.collection(COLLECTION).create({
		text: trimmed,
		note: note.trim(),
		wisher: me,
		household: households.activeId
	});

	// Von hier an ist der Wunsch fuer den Wuenschenden weg -- die Zahl ist das
	// Einzige, was von ihm bleibt. Hochzaehlen statt neu zu laden: der Create
	// ist gerade durchgelaufen, die Zahl kann nur um eins hoeher sein.
	if (typeof wishes.mine === 'number') wishes.mine += 1;

	return record;
}

/**
 * Der lesbare Grund fuer einen fehlgeschlagenen `addWish` -- oder null, wenn es
 * keiner der erwarteten Faelle ist.
 *
 * PocketBase haengt Feldfehler eines 400ers unter `response.data.<feld>`. Den
 * Text zum Doppelten formuliert der Hook (wishes.pb.js) und legt ihn unter
 * `text` ab: nur der Server weiss, was schon auf der Liste steht.
 *
 * Es gibt aber einen zweiten Weg zum selben Ergebnis. Laufen zwei Requests
 * gleichzeitig, findet die Abfrage im Hook noch nichts und der Unique-Index
 * schlaegt zu -- dann steht der Fehler unter `text_norm`/`wisher` und
 * `response.message` ist das englische „Failed to create record.". Dieser Pfad
 * ist nicht selten: bei einem Dutzend paralleler Creates ging etwa jeder
 * zweite ueber den Index. Er kennt den vorhandenen Wortlaut nicht, deshalb die
 * kuerzere Meldung.
 */
export function wishErrorMessage(err) {
	const data = err?.response?.data ?? {};
	if (data.text?.message) return data.text.message;

	const clash = data.text_norm?.code ?? data.wisher?.code ?? '';
	if (clash.includes('not_unique')) return 'Das steht schon auf deiner Liste.';

	// Ueber das Formular nicht erreichbar (das Textarea begrenzt selbst), aber der
	// einzige Grund, aus dem der Server `note` beanstanden kann.
	if (data.note?.message) return 'Die Beschreibung ist zu lang.';

	return null;
}
