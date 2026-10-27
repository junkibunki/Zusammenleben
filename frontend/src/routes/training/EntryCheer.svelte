<script module>
	const TITLES = ['Wuhu, geschafft!', 'Jawoll!', 'Stark, richtig stark!', 'Training im Kasten!', 'Juuubel'];

	const LINES = [
		'Die Hanteln zittern schon, wenn du reinkommst.',
		'Schwerkraft 0, du 1.',
		'Muskelkater ist nur der Applaus von innen.',
		'Irgendwo wird gerade ein Proteinshake nervös.',
		'Wenn Schweiß glitzern könnte, wärst du eine Discokugel.',
		'„Gewinne kannste des Ding eh net, weil de Bob Tschigerillo macht mit …“ – nach dem Training hat sich’s ausgebobbt.'
	];

	const pick = (list) => list[Math.floor(Math.random() * list.length)];

	/** Neuer Jubel: zufaellige Ueberschrift und Spruch. */
	export function makeCheer() {
		return { id: Date.now(), title: pick(TITLES), line: pick(LINES) };
	}
</script>

<script>
	import { scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import { reducedMotion } from '$lib/motion.js';
	import DragonSprite from '$lib/DragonSprite.svelte';

	// Jubel nach "Training speichern": kurz einblenden, nach ein paar Sekunden
	// oder per Tipp weg. Konfetti und der Drache mit Looping nur ohne
	// prefers-reduced-motion (CSS unten).
	let { cheer, onclose } = $props();

	const SHOW_MS = 4500;
	const CONFETTI = ['🎉', '💪', '🔥', '⭐', '🏋️', '✨'];
	// Pro Jubel neu gewuerfelt.
	const pieces = $derived(
		cheer
			? Array.from({ length: 18 }, (_, i) => ({
					emoji: CONFETTI[i % CONFETTI.length],
					left: Math.round(Math.random() * 100),
					delay: Math.round(Math.random() * 600),
					spin: Math.round(Math.random() * 720 - 360)
				}))
			: []
	);

	$effect(() => {
		if (!cheer) return;
		const t = setTimeout(() => onclose?.(), SHOW_MS);
		return () => clearTimeout(t);
	});

	function pop(node) {
		return reducedMotion() ? { duration: 0 } : scale(node, { duration: 350, start: 0.6, easing: backOut });
	}
</script>

<svelte:window onkeydown={(e) => cheer && e.key === 'Escape' && onclose?.()} />

{#if cheer}
	{#key cheer.id}
		<div class="fixed inset-0 z-50 flex items-center justify-center px-4">
			<!-- Ein Tipp irgendwohin schliesst; die Karte laesst ihn durch. -->
			<button
				type="button"
				class="absolute inset-0 cursor-default bg-black/20"
				onclick={() => onclose?.()}
				aria-label="Jubel schließen"
			></button>
			<div class="confetti pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
				{#each pieces as p, i (i)}
					<span
						style="left: {p.left}%; animation-delay: {p.delay}ms; --spin: {p.spin}deg"
					>{p.emoji}</span>
				{/each}
			</div>
			<div
				class="bg-card text-card-foreground pointer-events-none relative flex max-w-sm flex-col items-center gap-2 rounded-2xl px-6 py-6 text-center shadow-xl"
				role="status"
				in:pop
			>
				<span class="text-5xl" aria-hidden="true">🎉</span>
				<p class="text-xl font-semibold">{cheer.title}</p>
				<p class="text-muted-foreground">{cheer.line}</p>
			</div>
			<!-- Der Drache fliegt von links durchs Bild, dreht ueber der Karte einen
			     Looping und verschwindet rechts. Nach der Karte im DOM, damit er
			     ueber ihr liegt. -->
			<div class="dragon pointer-events-none absolute left-0" aria-hidden="true">
				<div class="loop">
					<DragonSprite />
				</div>
			</div>
		</div>
	{/key}
{/if}

<style>
	.confetti span {
		position: absolute;
		top: -2rem;
		font-size: 1.5rem;
		opacity: 0;
	}

	@media (prefers-reduced-motion: no-preference) {
		.confetti span {
			animation: fall 2.4s ease-in forwards;
		}
	}

	/* Der Flug ist zwei Transformationen: `.dragon` schiebt quer durchs Bild,
	   `.loop` dreht das Sprite um einen Punkt ueber ihm. Weil der Drehpunkt
	   ueber dem Drachen liegt, beschreibt er dabei einen Kreis *und* zeigt mit
	   der Nase immer in Flugrichtung -- genau ein Looping. Waehrend des Loopings
	   bremst die Querfahrt fast ab, sonst wuerde der Kreis zur Welle gezogen. */
	/* Der Scheitel des Loopings liegt 56 px (Drehpunkt) + 80 px (sichtbare
	   Spritehoehe) + 56 px (Radius) = 192 px ueber der Flugbahn. Auf einem
	   kurzen Viewport (iPhone SE in Safari: 553 px) waeren 27 % zu wenig,
	   deshalb die Untergrenze. */
	.dragon {
		top: max(27%, 12.5rem);
		opacity: 0;
	}

	.loop {
		transform-origin: 50% -56px;
	}

	@media (prefers-reduced-motion: no-preference) {
		.dragon {
			opacity: 1;
			will-change: transform;
			animation: cross 4.2s linear forwards;
		}

		.loop {
			animation: loop 4.2s linear forwards;
		}
	}

	@keyframes cross {
		0% {
			transform: translate3d(-30vw, 0, 0);
		}
		35% {
			transform: translate3d(calc(50vw - 100px), 0, 0);
		}
		65% {
			transform: translate3d(calc(50vw - 20px), 0, 0);
		}
		100% {
			transform: translate3d(115vw, 0, 0);
		}
	}

	@keyframes loop {
		0%,
		35% {
			transform: rotate(0deg);
			animation-timing-function: ease-in-out;
		}
		65%,
		100% {
			transform: rotate(-360deg);
		}
	}

	@keyframes fall {
		0% {
			transform: translateY(0) rotate(0);
			opacity: 1;
		}
		100% {
			transform: translateY(110vh) rotate(var(--spin));
			opacity: 0.8;
		}
	}
</style>
