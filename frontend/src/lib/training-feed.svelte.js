import { pb } from './pocketbase.svelte.js';

// Trainings-Feed (Migration 1789909200): die Beitraege aller, die ihre
// Trainings oeffentlich machen, plus die eigenen. Die Beitraege schreibt nur
// der Server; der Client aendert ausschliesslich `kudos` (Schulterklopfer),
// und zwar nur ueber `kudos+`/`kudos-`, damit gleichzeitige Klopfer zweier
// Leute sich nicht ueberschreiben.

const PER_PAGE = 20;
// `user` fuer Name und Foto, `kudos` fuer die Namen der Klopfer. Ueber den
// Haushalt hinaus sichtbar macht sie die View-Rule von `users` (1789909200).
const EXPAND = 'user,kudos';

export const feed = $state({
	posts: [],
	loading: true,
	loadingMore: false,
	hasMore: false,
	error: null
});

// Kein $state: nur Steuerung, siehe CLAUDE.md zu $effect-Schleifen.
let page = 0;
let loadedOnce = false;

function bySort(a, b) {
	return b.date.localeCompare(a.date) || String(b.created).localeCompare(String(a.created));
}

function upsert(record) {
	const idx = feed.posts.findIndex((p) => p.id === record.id);
	if (idx > -1) feed.posts[idx] = record;
	else {
		feed.posts.push(record);
		feed.posts.sort(bySort);
	}
}

/** Lesbare Meldung eines PocketBase-Fehlers. */
export function feedError(err, fallback) {
	const data = err?.response?.data ?? {};
	const first = Object.values(data).find((v) => v?.message);
	return first?.message ?? err?.message ?? fallback;
}

/**
 * Laedt die erste Seite und haengt sich an Realtime. Aufruf aus einem
 * $effect heraus; der Rueckgabewert ist das Teardown.
 */
export function syncFeed() {
	let cancelled = false;
	let unsubscribe = null;
	// Nicht feed.posts lesen: der Effekt hinge sonst an dem, was er gleich schreibt.
	feed.loading = !loadedOnce;
	feed.error = null;
	page = 1;

	pb.collection('training_posts')
		.getList(1, PER_PAGE, { sort: '-date,-created', expand: EXPAND, requestKey: null })
		.then((res) => {
			if (cancelled) return;
			feed.posts = res.items;
			feed.hasMore = res.page < res.totalPages;
			feed.loading = false;
			loadedOnce = true;
		})
		.catch((err) => {
			if (cancelled) return;
			feed.error = feedError(err, 'Feed konnte nicht geladen werden.');
			feed.loading = false;
		});

	pb.collection('training_posts')
		.subscribe(
			'*',
			(e) => {
				if (e.action === 'delete') {
					const idx = feed.posts.findIndex((p) => p.id === e.record.id);
					if (idx > -1) feed.posts.splice(idx, 1);
				} else if (
					e.action === 'update' ||
					!feed.hasMore ||
					feed.posts.length === 0 ||
					e.record.date >= feed.posts.at(-1).date
				) {
					// Neue Beitraege nur, wenn sie in den geladenen Bereich fallen --
					// sonst kaemen sie beim "Mehr laden" doppelt.
					upsert(e.record);
				}
			},
			{ expand: EXPAND }
		)
		.then((fn) => {
			if (cancelled) fn();
			else unsubscribe = fn;
		})
		.catch(() => {
			// Ohne Realtime geht es auch; dann eben erst beim naechsten Oeffnen.
		});

	return () => {
		cancelled = true;
		unsubscribe?.();
	};
}

/** Die naechste Seite nachladen. */
export async function loadMore() {
	if (feed.loadingMore || !feed.hasMore) return;
	feed.loadingMore = true;
	try {
		const res = await pb
			.collection('training_posts')
			.getList(page + 1, PER_PAGE, { sort: '-date,-created', expand: EXPAND, requestKey: null });
		page = res.page;
		for (const r of res.items) if (!feed.posts.some((p) => p.id === r.id)) feed.posts.push(r);
		feed.hasMore = res.page < res.totalPages;
	} catch (err) {
		feed.error = feedError(err, 'Weitere Beiträge konnten nicht geladen werden.');
	} finally {
		feed.loadingMore = false;
	}
}

/** Hat `userId` bei `post` schon auf die Schulter geklopft? */
export function hasKudos(post, userId) {
	return (post.kudos ?? []).includes(userId);
}

/**
 * Schulterklopfer setzen oder zuruecknehmen -- optimistisch, bei einem Fehler
 * zurueckgerollt. Nie beim eigenen Beitrag (das weist auch der Server ab).
 */
export async function toggleKudos(post) {
	const me = pb.authStore.record;
	if (!me || post.user === me.id) return;
	const had = hasKudos(post, me.id);
	const beforeIds = [...(post.kudos ?? [])];
	const beforeExpand = [...(post.expand?.kudos ?? [])];

	post.kudos = had ? beforeIds.filter((id) => id !== me.id) : [...beforeIds, me.id];
	post.expand = {
		...post.expand,
		kudos: had ? beforeExpand.filter((u) => u.id !== me.id) : [...beforeExpand, me]
	};
	try {
		const record = await pb
			.collection('training_posts')
			// requestKey: null -- sonst bricht ein zweiter Tipp den ersten ab, und der
			// Rollback meldet einen Fehler, den es nicht gab.
			.update(post.id, { [had ? 'kudos-' : 'kudos+']: me.id }, { expand: EXPAND, requestKey: null });
		upsert(record);
	} catch (err) {
		post.kudos = beforeIds;
		post.expand = { ...post.expand, kudos: beforeExpand };
		feed.error = feedError(err, 'Schulterklopfer hat nicht geklappt.');
	}
}
