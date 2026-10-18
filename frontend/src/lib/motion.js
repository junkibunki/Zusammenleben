import { slide } from 'svelte/transition';
import { cubicInOut, cubicOut } from 'svelte/easing';

// Uebergaenge fuer Listenzeilen: man soll sehen, was sich geaendert hat --
// auch wenn es jemand anderes per Realtime war. Svelte spielt sie als lokale
// Transitions nur, wenn die Zeile in eine schon stehende Liste kommt bzw. aus
// ihr geht, nicht beim ersten Aufbau der Seite oder beim Auf-/Zuklappen. Wer
// einen Block drumherum mit einblendet oder entfernt (z.B. den Abschnitt einer
// Kategorie), muss ihm selbst eine Transition geben, sonst springt er.

const SLIDE_MS = 380;
const GLOW_MS = 1600;
const GLOW_MAX = 22;

export function reducedMotion() {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function glowCss(amount) {
	return `background-color: color-mix(in oklch, var(--primary) ${Math.round(amount * GLOW_MAX)}%, transparent);`;
}

/** Einblenden: aufklappen und dabei einblenden, danach klingt ein gruener Schimmer ab. */
export function enter(node, { glow = true } = {}) {
	if (reducedMotion()) return { duration: 0 };
	const open = slide(node, { duration: SLIDE_MS });
	const duration = glow ? GLOW_MS : SLIDE_MS;
	const share = SLIDE_MS / duration;
	return {
		duration,
		css: (t, u) => {
			const p = Math.min(1, t / share);
			const e = cubicOut(p);
			const height = p < 1 ? `${open.css(e, 1 - e)} opacity: ${e};` : '';
			return height + (glow ? glowCss(u * u) : '');
		}
	};
}

/** Ausblenden: weich zusammenfallen und dabei ausblenden. */
export function leave(node) {
	if (reducedMotion()) return { duration: 0 };
	const close = slide(node, { duration: SLIDE_MS });
	return {
		duration: SLIDE_MS,
		easing: cubicInOut,
		css: (t, u) => `${close.css(t, u)} opacity: ${t};`
	};
}
