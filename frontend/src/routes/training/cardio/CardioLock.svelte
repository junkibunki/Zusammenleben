<script>
	import { onMount } from 'svelte';
	import ChevronsUpIcon from '@lucide/svelte/icons/chevrons-up';

	// Sperrbildschirm waehrend der Aufzeichnung: schwarz, damit ein OLED-Display
	// fast nichts leuchtet (die Helligkeit selbst kann eine Webseite nicht
	// regeln), und unempfindlich gegen Beruehrungen in der Tasche. Entsperrt
	// wird nur mit einem Wisch von der Griffleiste unten nach oben.
	let { time, distance, onunlock } = $props();

	/** So weit (px) muss der Wisch nach oben gehen. */
	const UNLOCK_PX = 160;

	let startY = null;
	let pointer = null;
	let dy = $state(0);
	// Alle paar Minuten ein paar Pixel weiter, damit nichts einbrennt.
	let shift = $state(0);

	onMount(() => {
		const id = setInterval(() => (shift = (shift + 1) % 5), 120000);
		// Auch die Statusleiste schwarz (iOS kennt kein Vollbild fuer Seiten).
		const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
		const before = metas.map((m) => m.content);
		for (const m of metas) m.content = '#000000';
		return () => {
			clearInterval(id);
			metas.forEach((m, i) => (m.content = before[i]));
		};
	});

	function down(e) {
		// Ein neuer Finger ersetzt einen alten, dessen pointerup nie kam -- sonst
		// haenge man hinter dem schwarzen Bildschirm fest.
		pointer = e.pointerId;
		startY = e.clientY;
		e.currentTarget.setPointerCapture(e.pointerId);
	}

	function move(e) {
		if (e.pointerId !== pointer) return;
		dy = Math.min(0, e.clientY - startY);
	}

	function up(e) {
		if (e.pointerId !== pointer) return;
		const done = dy <= -UNLOCK_PX;
		pointer = null;
		startY = null;
		dy = 0;
		if (done) onunlock();
	}
</script>

<!-- Fängt jede Berührung ab; nur die Griffleiste reagiert. -->
<div
	class="fixed inset-0 z-[2000] flex touch-none flex-col items-center justify-between bg-black select-none"
	role="dialog"
	tabindex="-1"
	aria-modal="true"
	aria-label="Bildschirm gesperrt"
	oncontextmenu={(e) => e.preventDefault()}
>
	<div
		class="mt-[30vh] flex flex-col items-center gap-2 text-neutral-700 tabular-nums"
		style="transform: translate({shift * 6 - 12}px, {shift * 8 - 16}px)"
	>
		<span class="text-5xl font-semibold" role="timer">{time}</span>
		<span class="text-2xl">{distance}</span>
	</div>

	<div
		class="flex w-full flex-col items-center gap-2 pt-10 pb-[calc(2.5rem+env(safe-area-inset-bottom))] text-neutral-600"
		style="transform: translateY({dy}px); opacity: {1 - Math.min(1, -dy / UNLOCK_PX) * 0.6}"
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={up}
		onlostpointercapture={up}
		aria-hidden="true"
	>
		<ChevronsUpIcon class="size-8" />
		<span class="text-sm">Zum Entsperren nach oben wischen</span>
		<span class="mt-2 h-1.5 w-24 rounded-full bg-neutral-700"></span>
	</div>

	<!-- Fuer Tastatur und Screenreader; unsichtbar, also kein Ziel fuer die Tasche. -->
	<button type="button" class="sr-only" onclick={onunlock}>Entsperren</button>
</div>
