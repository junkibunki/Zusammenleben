import { reducedMotion } from './motion.js';

// Wischen nach links auf einer Listenzeile. Svelte-Action auf der *bewegten*
// Zeile; der Loeschen-Knopf liegt als Geschwister dahinter (absolut, rechts).
// Kurz gezogen rastet die Zeile ein und legt den Knopf frei, weit gezogen
// loescht das Loslassen direkt. Die Action bewegt nur den Transform -- ob eine
// Zeile offen ist, weiss die Seite (`open`), damit es immer nur eine ist.
//
//   use:swipe={{ open, onopen, onclose, ondelete }}
//     open     : die Zeile zeigt gerade den Knopf (steuert die Seite)
//     onopen   : nach dem Loslassen eingerastet
//     onclose  : zugeschoben (zurueckgewischt oder auf die offene Zeile getippt)
//     ondelete : weit genug gezogen und losgelassen
//
// Waehrend die Zeile ueber der Loeschschwelle steht, traegt der Elternknoten
// `data-far` -- die Seite nutzt das nur fuer die Optik des Knopfs.

/** Breite des freigelegten Knopfs in px; muss zu `w-22` in der Seite passen. */
export const REVEAL = 88;
const LOCK = 8; // px, ab hier ist es ein Wischen -- oder ein Scrollen
const SNAP = REVEAL / 2; // px, ab hier bleibt der Knopf nach dem Loslassen offen
const FAR = 0.5; // Anteil der Zeilenbreite, ab dem Loslassen sofort loescht
// Nach dem Loeschen bleibt die Zeile so lange ganz draussen; laenger als die
// leave-Transition. Steht sie danach noch (Loeschen fehlgeschlagen, Zeile
// zurueckgerollt), faehrt sie wieder ein.
const GONE_MS = 450;

export function swipe(node, params) {
	let drag = null; // { id, x0, y0, base, axis } waehrend einer Geste
	let moved = false; // letzte Geste war ein Wischen: den Klick danach schlucken
	let far = false;
	let gone = null; // Timer nach ondelete: solange kein settle() von aussen

	const clamp = (x) => Math.max(-node.offsetWidth, Math.min(0, x));

	function settle(px) {
		node.style.transition = reducedMotion()
			? ''
			: 'transform 200ms cubic-bezier(0.2, 0, 0, 1)';
		node.style.transform = px ? `translateX(${px}px)` : '';
	}

	function setFar(v) {
		if (v === far) return;
		far = v;
		node.parentElement?.toggleAttribute('data-far', v);
		if (v) navigator.vibrate?.(10);
	}

	function down(e) {
		// Ein zweiter Finger waehrend eines Wischens zaehlt nicht. Vor dem
		// Einrasten darf ein neuer Druck den alten ersetzen: ohne Capture kann
		// das pointerup des alten verloren gegangen sein (Maus aus der Zeile).
		if (e.button !== 0 || gone || drag?.axis) return;
		moved = false;
		drag = {
			id: e.pointerId,
			x0: e.clientX,
			y0: e.clientY,
			base: params.open ? -REVEAL : 0,
			axis: null
		};
	}

	function move(e) {
		if (!drag || e.pointerId !== drag.id) return;
		const dx = e.clientX - drag.x0;
		const dy = e.clientY - drag.y0;
		if (!drag.axis) {
			if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return;
			if (Math.abs(dy) > Math.abs(dx)) {
				// Eher senkrecht: das ist Scrollen, der Browser uebernimmt.
				drag = null;
				return;
			}
			drag.axis = 'x';
			moved = true;
			node.setPointerCapture(drag.id);
			node.style.transition = 'none';
		}
		const x = clamp(drag.base + dx);
		node.style.transform = `translateX(${x}px)`;
		setFar(-x > node.offsetWidth * FAR);
	}

	function up(e) {
		if (!drag || e.pointerId !== drag.id) return;
		const { axis, base, x0 } = drag;
		drag = null;
		if (!axis) return; // nur getippt -- das regelt der Klick
		const x = clamp(base + (e.clientX - x0));
		if (far) {
			setFar(false);
			settle(-node.offsetWidth);
			gone = setTimeout(() => {
				gone = null;
				if (node.isConnected) settle(params.open ? -REVEAL : 0);
			}, GONE_MS);
			params.ondelete?.();
		} else if (-x > SNAP) {
			settle(-REVEAL);
			if (!params.open) params.onopen?.();
		} else {
			settle(0);
			if (params.open) params.onclose?.();
		}
	}

	function cancel(e) {
		if (!drag || e.pointerId !== drag.id) return;
		drag = null;
		setFar(false);
		settle(params.open ? -REVEAL : 0);
	}

	// Capture-Phase, damit es vor dem Abhaken der Zeile greift: nach einem
	// Wischen zaehlt der Klick nicht, und ein Tipp auf die offene Zeile schiebt
	// sie nur zu.
	function click(e) {
		if (moved) {
			moved = false;
		} else if (params.open) {
			params.onclose?.();
		} else {
			return;
		}
		e.stopPropagation();
		e.preventDefault();
	}

	const prevent = (e) => e.preventDefault();

	// Neu aufgebaut, obwohl schon offen (die Zeile kam nach einem gescheiterten
	// Loeschen oder per Realtime als neuer Knoten zurueck): gleich dort stehen.
	if (params.open) node.style.transform = `translateX(${-REVEAL}px)`;

	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	node.addEventListener('pointerup', up);
	node.addEventListener('pointercancel', cancel);
	node.addEventListener('click', click, true);
	node.addEventListener('dragstart', prevent);

	return {
		update(next) {
			const was = params.open;
			params = next;
			if (!drag && !gone && was !== next.open) settle(next.open ? -REVEAL : 0);
		},
		destroy() {
			clearTimeout(gone);
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', up);
			node.removeEventListener('pointercancel', cancel);
			node.removeEventListener('click', click, true);
			node.removeEventListener('dragstart', prevent);
		}
	};
}
