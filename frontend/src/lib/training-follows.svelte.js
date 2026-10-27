import { pb } from './pocketbase.svelte.js';
import { feedError } from './training-feed.svelte.js';

// Personen folgen (Migration 1790254800): die eigenen Zeilen in
// `training_follows`, mit der gefolgten Person per `expand`. Wer folgt, bekommt
// eine Push-Meldung, sobald die Person ein Training veroeffentlicht
// (pb_hooks/training.pb.js). Gefolgt werden kann nur, wer Training
// eingeschaltet hat (`users.show_training`) -- das prueft die CreateRule.

const EXPAND = 'followed';

export const follows = $state({
	list: [],
	loading: true,
	error: null
});

// Kein $state: nur Steuerung, siehe CLAUDE.md zu $effect-Schleifen.
let loadedOnce = false;

function upsert(record) {
	const idx = follows.list.findIndex((f) => f.id === record.id);
	if (idx > -1) follows.list[idx] = record;
	else follows.list.push(record);
}

/**
 * Laedt die eigenen Follows und haengt sich an Realtime. Aufruf aus einem
 * $effect heraus; der Rueckgabewert ist das Teardown.
 */
export function syncFollows() {
	const me = pb.authStore.record;
	if (!me) return () => {};
	let cancelled = false;
	let unsubscribe = null;
	follows.loading = !loadedOnce;
	follows.error = null;

	pb.collection('training_follows')
		.getFullList({ filter: pb.filter('follower = {:u}', { u: me.id }), expand: EXPAND, requestKey: null })
		.then((records) => {
			if (cancelled) return;
			follows.list = records;
			follows.loading = false;
			loadedOnce = true;
		})
		.catch((err) => {
			if (cancelled) return;
			follows.error = feedError(err, 'Wem du folgst, ließ sich nicht laden.');
			follows.loading = false;
		});

	// Die ListRule laesst nur die eigenen Zeilen durch, ein Filter ist nicht noetig.
	pb.collection('training_follows')
		.subscribe(
			'*',
			(e) => {
				if (e.action === 'delete') {
					const idx = follows.list.findIndex((f) => f.id === e.record.id);
					if (idx > -1) follows.list.splice(idx, 1);
				} else {
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
			// Ohne Realtime geht es auch.
		});

	return () => {
		cancelled = true;
		unsubscribe?.();
	};
}

/** Folge ich `userId`? */
export function isFollowing(userId) {
	return follows.list.some((f) => f.followed === userId);
}

/**
 * `user` folgen. Der Record kommt mit `expand`; bleibt der leer (die Person
 * ist fuer mich nicht sichtbar), steht der gesuchte User lokal drin.
 */
export async function follow(user) {
	const me = pb.authStore.record;
	if (!me || !user?.id || user.id === me.id || isFollowing(user.id)) return;
	follows.error = null;
	try {
		const record = await pb
			.collection('training_follows')
			.create({ follower: me.id, followed: user.id }, { expand: EXPAND, requestKey: null });
		if (!record.expand?.followed) record.expand = { ...record.expand, followed: user };
		upsert(record);
	} catch (err) {
		follows.error = feedError(err, 'Folgen hat nicht geklappt.');
	}
}

/** `userId` nicht mehr folgen -- optimistisch, bei einem Fehler zurueckgerollt. */
export async function unfollow(userId) {
	const idx = follows.list.findIndex((f) => f.followed === userId);
	if (idx === -1) return;
	const [record] = follows.list.splice(idx, 1);
	follows.error = null;
	try {
		await pb.collection('training_follows').delete(record.id, { requestKey: null });
	} catch (err) {
		if (!follows.list.some((f) => f.id === record.id)) follows.list.push(record);
		follows.error = feedError(err, 'Entfolgen hat nicht geklappt.');
	}
}

/**
 * Accounts mit eingeschaltetem Training, deren Name `query` enthaelt -- app-weit,
 * nicht nur der Haushalt (ListRule von `users`, 1790254800). Ohne mich selbst.
 */
export async function searchUsers(query) {
	const me = pb.authStore.record;
	const q = query.trim();
	if (!me || !q) return [];
	const res = await pb.collection('users').getList(1, 20, {
		filter: pb.filter('show_training = true && id != {:me} && name ~ {:q}', { me: me.id, q }),
		sort: 'name',
		requestKey: 'user-search'
	});
	return res.items;
}
