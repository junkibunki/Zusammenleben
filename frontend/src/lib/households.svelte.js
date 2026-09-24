import { pb } from './pocketbase.svelte.js';

// Haushalte des angemeldeten Nutzers (Migration 1789304400). Welche es gibt und
// wer wo Mitglied ist, pflegt der Superuser im Admin-UI; hier wird nur gelesen
// und der *aktive* Haushalt gewaehlt, auf den sich Liste, Ausgaben, Wuensche
// und der Standort des Autos beziehen.

export const households = $state({
	// { id, name, carName, role: 'haupt' | 'gast', until } -- nur laufende
	// Mitgliedschaften, Haupthaushalt zuerst.
	list: [],
	activeId: '',
	loading: true,
	error: null
});

/** Laeuft die Mitgliedschaft noch? Leeres `until` heisst: unbefristet. */
export function isActiveMembership(membership) {
	if (!membership?.until) return true;
	const end = new Date(String(membership.until).replace(' ', 'T'));
	return Number.isNaN(end.getTime()) || end.getTime() > Date.now();
}

/** Der aktive Haushalt als Eintrag aus `households.list`; null, wenn keiner. */
export function activeHousehold() {
	return households.list.find((h) => h.id === households.activeId) ?? null;
}

/**
 * Wie der aktive Haushalt sein Auto nennt (Migration 1789390800). Das Feld ist
 * Pflicht; "Auto" greift nur, solange noch kein Haushalt geladen ist.
 */
export function carName() {
	return activeHousehold()?.carName || 'Auto';
}

/** Maximale Laenge von `car_name` -- muss mit Migration 1789390800 uebereinstimmen. */
export const CAR_NAME_MAX = 40;

/**
 * Den Namen des Autos aendern; darf nur ein Haupt-Mitglied (Migration
 * 1789477200). Lokal gleich mitgesetzt, das Realtime-Event laedt ohnehin neu.
 */
export async function setCarName(householdId, name) {
	const record = await pb.collection('households').update(householdId, { car_name: name.trim() });
	const entry = households.list.find((h) => h.id === householdId);
	if (entry) entry.carName = record.car_name;
}

/** Genitiv eines Namens: "Gundulas", aber "Max'" -- fuer "…s Standort". */
export function genitive(name) {
	return /[sßxz]$/i.test(name) ? `${name}'` : `${name}s`;
}

// Pro Account gemerkt: auf einem geteilten Geraet soll der naechste nicht im
// Haushalt des vorigen landen.
const storageKey = (userId) => `einkauf.household.${userId}`;

function remembered(userId) {
	try {
		return localStorage.getItem(storageKey(userId)) ?? '';
	} catch {
		return '';
	}
}

let currentUser = '';

/** Wechselt den aktiven Haushalt. Die Seiten laden dann selbst neu. */
export function setActiveHousehold(id) {
	if (!households.list.some((h) => h.id === id)) return;
	households.activeId = id;
	try {
		localStorage.setItem(storageKey(currentUser), id);
	} catch {
		// Ohne Speicher gilt die Wahl eben nur bis zum Neuladen.
	}
}

/**
 * Laedt die eigenen Mitgliedschaften und haelt sie per Realtime aktuell --
 * ordnet der Superuser jemanden zu, erscheint der Haushalt ohne Neuladen.
 * Aufruf aus einem $effect heraus; der Rueckgabewert ist das Teardown.
 */
export function syncHouseholds(userId) {
	let cancelled = false;
	// Kein $state: nur Steuerung, siehe CLAUDE.md zu $effect-Schleifen.
	let expiryTimer = null;
	currentUser = userId;
	households.loading = true;
	households.error = null;

	const load = () =>
		pb
			.collection('memberships')
			.getFullList({ filter: pb.filter('user = {:u}', { u: userId }), expand: 'household' })
			.then((records) => {
				if (cancelled) return;
				const list = records
					.filter((m) => m.expand?.household && isActiveMembership(m))
					.map((m) => ({
						id: m.household,
						name: m.expand.household.name,
						carName: m.expand.household.car_name,
						role: m.role,
						until: m.until
					}))
					.sort(
						(a, b) =>
							(a.role === 'haupt' ? 0 : 1) - (b.role === 'haupt' ? 0 : 1) ||
							a.name.localeCompare(b.name, 'de')
					);
				households.list = list;

				const wanted = households.activeId || remembered(userId);
				households.activeId = list.some((h) => h.id === wanted) ? wanted : (list[0]?.id ?? '');
				households.loading = false;

				// Eine Gastmitgliedschaft kann ablaufen, waehrend die App offen ist.
				// Die Rules sperren dann ohnehin; hier verschwindet der Haushalt nur
				// auch aus der Auswahl, statt Fehler zu produzieren.
				clearTimeout(expiryTimer);
				const next = Math.min(
					...list
						.filter((h) => h.until)
						.map((h) => new Date(String(h.until).replace(' ', 'T')).getTime() - Date.now())
				);
				// setTimeout vertraegt hoechstens ~24,8 Tage.
				if (Number.isFinite(next) && next < 2 ** 31 - 1) {
					expiryTimer = setTimeout(load, Math.max(next, 0) + 1000);
				}
			})
			.catch(() => {
				if (cancelled) return;
				households.error = 'Die Haushalte konnten nicht geladen werden.';
				households.loading = false;
			});

	load();

	// Nur die eigenen Zeilen -- die ListRule liefert auch die der Mitbewohner.
	// Bei jeder Aenderung neu laden statt zu flicken: der Name des Haushalts
	// kommt aus dem expand, und die Sortierung haengt an der Rolle.
	pb.collection('memberships').subscribe('*', () => load(), {
		filter: pb.filter('user = {:u}', { u: userId })
	});
	// Und die Haushalte selbst: benennt der Superuser einen (oder sein Auto) um,
	// soll das ohne Neuladen dastehen. Die ListRule liefert nur die eigenen.
	pb.collection('households').subscribe('*', () => load());

	return () => {
		cancelled = true;
		clearTimeout(expiryTimer);
		pb.collection('memberships').unsubscribe('*');
		pb.collection('households').unsubscribe('*');
		households.list = [];
		households.activeId = '';
		households.loading = true;
	};
}

/**
 * Alle Mitglieder eines Haushalts als User-Records, jeweils mit `membership`
 * ({ role, until, active }). Auch abgelaufene Gaeste: in alten Ausgaben soll
 * ihr Name stehen. Wer *jetzt* dazugehoert, sagt `membership.active`.
 */
export async function listMembers(householdId) {
	const rows = await pb.collection('memberships').getFullList({
		filter: pb.filter('household = {:h}', { h: householdId }),
		expand: 'user'
	});
	return rows
		.filter((m) => m.expand?.user)
		.map((m) => ({
			...m.expand.user,
			membership: { role: m.role, until: m.until, active: isActiveMembership(m) }
		}));
}
