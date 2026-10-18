// Gedaechtnis der Liste: welcher Artikel zuletzt in welcher Kategorie stand und
// wie oft er schon drauf war. Daraus kommen die Kategorie beim Tippen und die
// Vorschlaege. Liegt im localStorage dieses Geraets (pro Haushalt) -- die Items
// selbst sind nach dem "Aufraeumen" geloescht, sonst waere nichts mehr da.
// Ist der Speicher gesperrt (privates Fenster), gibt es eben keine Vorschlaege.

const MAX_ENTRIES = 300;

const storageKey = (household) => `einkauf-gedaechtnis:${household}`;

/** Vergleichsschluessel eines Artikelnamens. */
export const memoryKey = (name) => name.trim().toLowerCase();

function read(household) {
	try {
		return JSON.parse(localStorage.getItem(storageKey(household)) ?? '{}') ?? {};
	} catch {
		return {};
	}
}

/**
 * Nimmt die aktuellen Items ins Gedaechtnis auf und gibt es zurueck. Gezaehlt
 * wird jedes Item nur einmal: nur wer juenger ist als der letzte Eintrag unter
 * demselben Namen, erhoeht den Zaehler -- so darf das beliebig oft laufen.
 */
export function learn(household, items) {
	const memory = read(household);
	let changed = false;
	for (const item of items) {
		const key = memoryKey(item.name ?? '');
		if (!key) continue;
		// Ohne das "T" liest Safari den PocketBase-Zeitstempel nicht.
		const created = Date.parse(String(item.created ?? '').replace(' ', 'T')) || 0;
		const entry = memory[key];
		if (entry && created <= entry.last) continue;
		memory[key] = {
			name: item.name.trim(),
			category: item.category ?? '',
			count: (entry?.count ?? 0) + 1,
			last: created
		};
		changed = true;
	}
	if (!changed) return memory;

	const keys = Object.keys(memory);
	if (keys.length > MAX_ENTRIES) {
		keys
			.sort((a, b) => memory[a].last - memory[b].last)
			.slice(0, keys.length - MAX_ENTRIES)
			.forEach((k) => delete memory[k]);
	}
	try {
		localStorage.setItem(storageKey(household), JSON.stringify(memory));
	} catch {
		// Voll oder gesperrt: dann gilt das Gedaechtnis nur bis zum Neuladen.
	}
	return memory;
}
