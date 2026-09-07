// Welche Kategorien auf der Liste zugeklappt sind. Wer im Baumarkt steht und
// alles ausser "Baumarkt" zuklappt, will das nach dem naechsten Oeffnen der PWA
// nicht wiederholen -- deshalb liegt der Zustand im localStorage und nicht nur
// im Speicher der Seite.

import { CATEGORIES } from './items.svelte.js';

const KEY = 'einkaufsliste.collapsed';

/** Gespeicherte Kategorien; alles Unbrauchbare wird stillschweigend verworfen. */
function load() {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return [];
		const list = JSON.parse(raw);
		if (!Array.isArray(list)) return [];
		return list.filter((c) => CATEGORIES.includes(c));
	} catch {
		// Privater Modus, gesperrter Speicher, kaputter Eintrag: dann eben alles offen.
		return [];
	}
}

function save(list) {
	try {
		localStorage.setItem(KEY, JSON.stringify(list));
	} catch {
		// Nicht speichern zu koennen darf die Bedienung nicht stoppen.
	}
}

// Ein $state-Objekt statt eines exportierten Arrays: Svelte 5 erlaubt den
// Re-Export einer neu zugewiesenen $state-Variablen nicht.
export const collapse = $state({ categories: load() });

export function isCollapsed(category) {
	return collapse.categories.includes(category);
}

export function toggleCategory(category) {
	const idx = collapse.categories.indexOf(category);
	if (idx > -1) collapse.categories.splice(idx, 1);
	else collapse.categories.push(category);
	save(collapse.categories);
}

/** Aufklappen, ohne zu wissen, ob es zu war -- z.B. nach einem neuen Eintrag. */
export function expandCategory(category) {
	const idx = collapse.categories.indexOf(category);
	if (idx === -1) return;
	collapse.categories.splice(idx, 1);
	save(collapse.categories);
}
