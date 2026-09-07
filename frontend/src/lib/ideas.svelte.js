import { pb } from './pocketbase.svelte.js';

// Erweiterungsvorschlaege fuer die App. Collection aus Migration 1788872167.
const COLLECTION = 'ideas';

// Ohne expand stehen in `author`/`resolved_by` nur Record-IDs statt Namen.
const EXPAND = 'author,resolved_by';

/** Maximale Laenge von `text` -- muss mit der Migration uebereinstimmen. */
export const IDEA_MAX = 2000;

/** Die beiden Arten, eine Idee zu schliessen; leerer Status heisst "offen". */
export const STATUS = ['umgesetzt', 'abgelehnt'];

/** Ist die Idee abgehakt? */
export function isResolved(idea) {
	return Boolean(idea?.status);
}

export const ideas = $state({
	items: [],
	loading: true,
	error: null
});

// Bewusst *kein* $state: syncIdeas() laeuft in einem $effect, und ein reaktiver
// Lesezugriff dort haengt den Effekt an das, was sein eigener Ladevorgang
// anschliessend schreibt -- Endlosschleife aus Request und Neustart (CLAUDE.md).
let loadedOnce = false;

/**
 * Laedt den Feed (neuste zuerst) und haengt die Realtime-Subscription an.
 * Aufruf aus einem $effect heraus; der Rueckgabewert ist das Teardown.
 */
export function syncIdeas() {
	let cancelled = false;
	// Nur beim ersten Laden "Lade …": beim Zurueckkehren steht der Feed noch da.
	ideas.loading = !loadedOnce;
	ideas.error = null;

	pb.collection(COLLECTION)
		.getFullList({ sort: '-created', expand: EXPAND })
		.then((records) => {
			if (cancelled) return;
			ideas.items = records;
			ideas.loading = false;
			loadedOnce = true;
		})
		.catch((err) => {
			if (cancelled) return;
			ideas.error = err?.message ?? 'Laden fehlgeschlagen';
			ideas.loading = false;
		});

	// Das expand gehoert als drittes Argument dazu, sonst fehlen die Namen
	// genau bei den Eintraegen, die ueber Realtime hereinkommen.
	pb.collection(COLLECTION).subscribe(
		'*',
		(e) => {
			const items = ideas.items;
			const idx = items.findIndex((x) => x.id === e.record.id);

			if (e.action === 'create') {
				// idx > -1 heisst: lokal schon optimistisch eingefuegt.
				if (idx === -1) items.unshift(e.record); // neuste zuerst
				else items[idx] = e.record;
			} else if (e.action === 'update') {
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
		pb.collection(COLLECTION).unsubscribe('*');
	};
}

/**
 * Neue Idee posten. Wirft bei einem Fehler weiter -- die Seite entscheidet,
 * was sie anzeigt (und behaelt den Entwurf).
 */
export async function addIdea(text) {
	const trimmed = text.trim();
	if (!trimmed) return null;

	const record = await pb.collection(COLLECTION).create(
		{
			text: trimmed,
			author: pb.authStore.record?.id ?? ''
		},
		{ expand: EXPAND }
	);

	// Der Server schickt denselben Record gleich noch einmal ueber die
	// Subscription -- ohne diesen Check stuende er doppelt im Feed.
	if (!ideas.items.some((i) => i.id === record.id)) ideas.items.unshift(record);

	return record;
}

/**
 * Idee abhaken (`status` = "umgesetzt"/"abgelehnt") oder wieder oeffnen
 * (`status` = ""). Optimistisch, mit Rollback bei einem Fehler.
 */
export async function setIdeaStatus(idea, status) {
	const me = pb.authStore.record ?? null;
	if (!me) return; // ohne Auth wuerde der Request ohnehin scheitern
	if (status && !STATUS.includes(status)) return;

	const before = {
		status: idea.status,
		resolved_by: idea.resolved_by,
		resolved_at: idea.resolved_at,
		expand: idea.expand
	};

	// Erst lokal, dann Server. Der eigene User steht schon im authStore, also
	// kann auch der Name sofort stehen statt erst mit dem Realtime-Event.
	idea.status = status;
	idea.resolved_by = status ? me.id : '';
	idea.resolved_at = status ? new Date().toISOString() : '';
	idea.expand = { ...(idea.expand ?? {}), resolved_by: status ? me : undefined };

	try {
		const record = await pb.collection(COLLECTION).update(
			idea.id,
			{ status: idea.status, resolved_by: idea.resolved_by, resolved_at: idea.resolved_at },
			{ expand: EXPAND }
		);
		idea.status = record.status;
		idea.resolved_by = record.resolved_by;
		idea.resolved_at = record.resolved_at;
		idea.expand = record.expand ?? {};
	} catch (err) {
		idea.status = before.status;
		idea.resolved_by = before.resolved_by;
		idea.resolved_at = before.resolved_at;
		idea.expand = before.expand;
		ideas.error = err?.message ?? 'Speichern fehlgeschlagen';
	}
}
