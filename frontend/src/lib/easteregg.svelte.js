// Osterei: mit kleiner Wahrscheinlichkeit fliegt ein Pixeldrache durchs Bild.
// Ausgeloest von den beiden Ereignissen, die in dieser App ein kleines Fest sind:
// ein neuer Eintrag auf dem Zettel und ein neuer Parkplatz fuer Gundula.

/** Trefferquote pro Ereignis. */
export const CHANCE = 0.05;

// `id` waechst mit jedem Flug -- die Komponente haengt ihren #key daran und
// startet die CSS-Animation dadurch garantiert neu. `top` ist die Flughoehe in
// Prozent der Viewporthoehe: jeder Flug nimmt eine andere Bahn.
export const dragon = $state({ flying: false, id: 0, top: 30 });

/** Wer die Animation abbestellt hat, bekommt auch kein Osterei. */
function motionOk() {
	if (typeof window === 'undefined') return false;
	return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Notbremse: in einem unsichtbaren Tab haelt der Browser CSS-Animationen an,
// `animationend` kommt also nie -- ohne diesen Timer bliebe `flying` fuer immer
// stehen und kein weiteres Osterei koennte je starten.
let safety;

/** Startet den Flug sofort. Getrennt von maybeFly(), damit man ihn testen kann. */
export function fly() {
	if (dragon.flying || !motionOk()) return false;
	// Nicht zu hoch (Topbar) und nicht zu tief (Eingabeleiste, Kartenbedienung).
	dragon.top = 20 + Math.random() * 45;
	dragon.id += 1;
	dragon.flying = true;
	clearTimeout(safety);
	safety = setTimeout(landed, 8000);
	return true;
}

/**
 * Wuerfelt und startet den Flug bei einem Treffer.
 *
 * Wirft nie: der Aufruf sitzt in `addItem()` und `parkGundula()`, deren Rejection
 * die Seite als "Speichern fehlgeschlagen" anzeigt. Ein Fehler aus dem Osterei
 * wuerde also einen *erfolgreichen* Speichervorgang als gescheitert melden.
 */
export function maybeFly() {
	try {
		if (Math.random() >= CHANCE) return false;
		return fly();
	} catch {
		return false;
	}
}

/** Ruft die Komponente am Ende der Animation. */
export function landed() {
	clearTimeout(safety);
	dragon.flying = false;
}
