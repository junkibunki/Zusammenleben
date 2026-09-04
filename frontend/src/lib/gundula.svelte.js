import { pb } from './pocketbase.svelte.js';
import { maybeFly } from './easteregg.svelte.js';

// Genau ein Record, angelegt von Migration 1756000020 -- die ID darf der Client
// deshalb kennen.
const COLLECTION = 'car_location';
const RECORD_ID = 'gundula';

// Ohne expand steht in `parked_by` nur eine Record-ID statt eines Namens.
const EXPAND = 'parked_by';

export const gundula = $state({
	record: null,
	loading: true,
	error: null
});

// Bewusst *kein* $state: syncGundula() laeuft in einem $effect, und ein reaktiver
// Lesezugriff dort haengt den Effekt an das, was sein eigener Ladevorgang
// anschliessend schreibt -- Endlosschleife aus Request und Neustart (CLAUDE.md).
let loadedOnce = false;

/** Hat Gundula schon einmal geparkt? `parked_at` ist die einzige verlaessliche Marke. */
export function hasLocation(record) {
	return Boolean(record?.parked_at);
}

/**
 * Laedt den Standort und haengt die Realtime-Subscription an.
 * Aufruf aus einem $effect heraus; der Rueckgabewert ist das Teardown.
 */
export function syncGundula() {
	let cancelled = false;
	// Nur beim ersten Mal "Lade …": beim Zurueckkehren steht die Karte schon.
	gundula.loading = !loadedOnce;
	gundula.error = null;

	pb.collection(COLLECTION)
		.getOne(RECORD_ID, { expand: EXPAND })
		.then((record) => {
			if (cancelled) return;
			gundula.record = record;
			gundula.loading = false;
			loadedOnce = true;
		})
		.catch((err) => {
			if (cancelled) return;
			gundula.error = err?.message ?? 'Laden fehlgeschlagen';
			gundula.loading = false;
		});

	// Auf den einen Record hoeren, nicht auf '*': parkt jemand anders, wandert der
	// Pin sofort mit. Das expand gehoert als drittes Argument dazu, sonst fehlt
	// genau hier der Name.
	pb.collection(COLLECTION).subscribe(
		RECORD_ID,
		(e) => {
			if (e.action === 'update' && e.record) gundula.record = e.record;
		},
		{ expand: EXPAND }
	);

	return () => {
		cancelled = true;
		pb.collection(COLLECTION).unsubscribe(RECORD_ID);
	};
}

/**
 * Setzt Gundulas Standort. Wirft bei einem Fehler weiter -- die Seite
 * entscheidet, was sie anzeigt.
 */
export async function parkGundula(lat, lng) {
	const me = pb.authStore.record;
	if (!me) throw new Error('Nicht angemeldet');

	const record = await pb.collection(COLLECTION).update(
		RECORD_ID,
		{
			lat,
			lng,
			parked_by: me.id,
			parked_at: new Date().toISOString()
		},
		{ expand: EXPAND }
	);

	gundula.record = record;

	// Osterei: nur beim Parkenden wuerfeln, nicht bei allen Zuschauern.
	maybeFly();

	return record;
}

/**
 * Aktuelle Position des Geraets. Liefert deutsche Fehlermeldungen -- die des
 * Browsers sind englisch und je Hersteller anders formuliert.
 */
export function currentPosition({ timeout = 15000 } = {}) {
	return new Promise((resolve, reject) => {
		if (!navigator.geolocation) {
			reject(new Error('Dieses Gerät kann seinen Standort nicht melden.'));
			return;
		}

		navigator.geolocation.getCurrentPosition(
			(pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
			(err) => {
				if (err.code === err.PERMISSION_DENIED) {
					reject(
						new Error(
							'Der Zugriff auf den Standort ist blockiert. Erlaube ihn in den Browser-Einstellungen — oder tippe den Platz auf der Karte an.'
						)
					);
				} else if (err.code === err.POSITION_UNAVAILABLE) {
					reject(new Error('Der Standort ist gerade nicht zu ermitteln.'));
				} else if (err.code === err.TIMEOUT) {
					reject(new Error('Die Standortsuche hat zu lange gedauert.'));
				} else {
					reject(new Error('Der Standort ist nicht zu ermitteln.'));
				}
			},
			{ enableHighAccuracy: true, timeout, maximumAge: 0 }
		);
	});
}
