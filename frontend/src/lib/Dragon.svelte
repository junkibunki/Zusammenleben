<script>
	import { dragon, landed } from '$lib/easteregg.svelte.js';

	// Der Drache ist ein Pixelsprite: ein Zeichenraster, ein Zeichen je Pixel.
	// Das Raster *ist* die Zeichnung -- in einer Monospace-Ansicht sieht man,
	// was gerendert wird, und kann es dort auch aendern.
	const PALETTE = {
		o: '#1b4d2b', // Umriss
		g: '#57b04b', // Koerper
		l: '#93d873', // Flughaut
		b: '#f3e3a6', // Bauch
		e: '#ffffff', // Auge
		p: '#14261a' // Pupille
	};

	// 20 x 14 Pixel, Blickrichtung rechts. Fluegel steckt in eigenen Rastern,
	// damit der Koerper nur einmal beschrieben ist.
	const BODY = [
		'....................',
		'.............g..g.g.',
		'.............g.g.g..',
		'.............oggggo.',
		'............ogeepgo.',
		'.oo........oggggpggo',
		'olgo..ogggggggggggo.',
		'olggggggggggggggggo.',
		'.ooggggggggggggbbo..',
		'...ogggggggggbbbo...',
		'....oobbbbbbbbbbo...',
		'.....oobboooobboo...',
		'......obbo.obbo.....',
		'......oooo.oooo.....'
	];

	// Zwei Fluegelstellungen: hochgestellt und ausgebreitet. Der Wechsel ist der
	// Fluegelschlag -- kein Drehen, sonst waeren die Pixel nicht mehr kantig.
	const WING_UP = {
		x: 5,
		y: 0,
		rows: ['..ooo..', '.olllo.', '.ollllo', '.ollllo', '..olllo', '...lll.']
	};

	const WING_OUT = {
		x: 3,
		y: 2,
		rows: ['...oooo..', '..olllllo', '.olllllo.', '..ollll..']
	};

	/** Raster -> Liste von Rechtecken, transparente Zeichen fallen raus. */
	function pixels(rows, ox = 0, oy = 0) {
		const out = [];
		rows.forEach((row, y) => {
			[...row].forEach((ch, x) => {
				const fill = PALETTE[ch];
				if (fill) out.push({ x: x + ox, y: y + oy, fill });
			});
		});
		return out;
	}

	const body = pixels(BODY);
	const wingUp = pixels(WING_UP.rows, WING_UP.x, WING_UP.y);
	const wingOut = pixels(WING_OUT.rows, WING_OUT.x, WING_OUT.y);
</script>

{#if dragon.flying}
	<!-- #key: jeder Flug ist ein neues Element, damit die CSS-Animation von vorn
	     beginnt statt mitten im Lauf weiterzulaufen. -->
	{#key dragon.id}
		<div
			class="flight"
			style="top: {dragon.top}%"
			aria-hidden="true"
			onanimationend={landed}
		>
			<div class="bob">
				<svg viewBox="-2 -2 24 18" width="120" shape-rendering="crispEdges">
					{#each body as px (`${px.x}:${px.y}`)}
						<rect x={px.x} y={px.y} width="1" height="1" fill={px.fill} />
					{/each}
					<g class="wing-up">
						{#each wingUp as px (`${px.x}:${px.y}`)}
							<rect x={px.x} y={px.y} width="1" height="1" fill={px.fill} />
						{/each}
					</g>
					<g class="wing-out">
						{#each wingOut as px (`${px.x}:${px.y}`)}
							<rect x={px.x} y={px.y} width="1" height="1" fill={px.fill} />
						{/each}
					</g>
				</svg>
			</div>
		</div>
	{/key}
{/if}

<style>
	/* Rein dekorativ: nichts davon darf einen Tap abfangen. */
	.flight {
		position: fixed;
		left: 0;
		/* Ueber Topbar (z-20) und Eingabeleiste (z-10), aber unter den
		   shadcn-Overlays (z-50) -- ein Osterei gehoert nicht ueber einen Dialog. */
		z-index: 40;
		pointer-events: none;
		will-change: transform;
		animation: cross 4.4s linear forwards;
	}

	/* Von links aus dem Bild heraus nach rechts wieder hinaus. */
	@keyframes cross {
		from {
			transform: translate3d(-30vw, 0, 0);
		}
		to {
			transform: translate3d(115vw, 0, 0);
		}
	}

	.bob {
		animation: bob 1.1s ease-in-out infinite alternate;
	}

	@keyframes bob {
		from {
			transform: translateY(-10px);
		}
		to {
			transform: translateY(10px);
		}
	}

	/* Harter Schnitt zwischen den zwei Stellungen: steps(1) statt Überblendung,
	   sonst sind beide Fluegel halb sichtbar und es sieht nach Doppelbild aus. */
	.wing-up,
	.wing-out {
		animation: flap 0.34s steps(1, end) infinite;
	}

	.wing-out {
		animation-delay: -0.17s;
	}

	@keyframes flap {
		0% {
			opacity: 1;
		}
		50% {
			opacity: 0;
		}
		100% {
			opacity: 1;
		}
	}

	/* Wer Animationen abbestellt hat, sieht das Osterei gar nicht -- der Store
	   startet den Flug dann nicht. Der Media-Query hier ist der zweite Riegel. */
	@media (prefers-reduced-motion: reduce) {
		.flight {
			display: none;
		}
	}
</style>
