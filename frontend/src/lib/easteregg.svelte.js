// Osterei: ein Pixeldrache fliegt durchs Bild. Meist zufaellig, ausgeloest von
// den beiden Ereignissen, die in dieser App ein kleines Fest sind: ein neuer
// Eintrag auf dem Zettel und ein neuer Parkplatz fuer Gundula. Wer ihn sehen
// *will*, tippt fuenfmal aufs Profilbild -- da wird nicht gewuerfelt.

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

/** So viele Tipps aufs Profilbild braucht es -- dann aber sicher, ohne Wuerfeln. */
export const TAPS = 5;

// Bewusst gewoehnliche Modulvariablen: den Zwischenstand rendert niemand, ein
// $state waere hier nur eine Reaktivitaetsfalle (CLAUDE.md).
let taps = 0;
let lastTap = 0;

/**
 * Zaehlt einen Tipp aufs Profilbild und startet beim fuenften den Flug.
 *
 * Die Serie laeuft ab: ohne das Zeitfenster summieren sich einzelne Tipps ueber
 * Stunden zu einem Treffer, den niemand ausgeloest hat.
 */
export function tapAvatar() {
	const now = Date.now();
	if (now - lastTap > 1500) taps = 0;
	lastTap = now;
	taps += 1;
	if (taps < TAPS) return false;
	// Nur ein wirklich gestarteter Flug verbraucht die Serie: laeuft gerade schon
	// einer (oder sind Animationen abbestellt), waeren die fuenf Tipps sonst
	// wirkungslos vertan.
	if (!fly()) return false;
	taps = 0;
	return true;
}
