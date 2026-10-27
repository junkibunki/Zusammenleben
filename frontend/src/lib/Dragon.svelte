<script>
	import { dragon, landed } from '$lib/easteregg.svelte.js';
	import DragonSprite from '$lib/DragonSprite.svelte';
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
				<DragonSprite />
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

	/* Wer Animationen abbestellt hat, sieht das Osterei gar nicht -- der Store
	   startet den Flug dann nicht. Der Media-Query hier ist der zweite Riegel. */
	@media (prefers-reduced-motion: reduce) {
		.flight {
			display: none;
		}
	}
</style>
