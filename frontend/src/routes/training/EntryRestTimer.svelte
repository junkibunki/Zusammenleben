<script>
	import TimerIcon from '@lucide/svelte/icons/timer';
	import BellRingIcon from '@lucide/svelte/icons/bell-ring';
	import Volume2Icon from '@lucide/svelte/icons/volume-2';
	import VolumeXIcon from '@lucide/svelte/icons/volume-x';
	import { formatDuration } from '$lib/training.svelte.js';
	import {
		timer,
		addRest,
		skipRest,
		restLeft,
		restFraction,
		toggleSound,
		COUNTDOWN_S
	} from '$lib/training-timer.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';

	// Leiste unten mit der laufenden Satzpause. Liegt `fixed` und bringt die
	// Safe-Area selbst mit; die Seite haelt unten Platz frei, solange sie steht.
	// Am Ende: Ton + Vibration (training-timer.svelte.js), die Leiste wird
	// gruen und bleibt stehen, bis man sie wegtippt, den naechsten Satz abhakt
	// oder eine Minute vorbei ist.

	const left = $derived(restLeft());
	const ending = $derived(timer.restEnd > 0 && left <= COUNTDOWN_S);
	// Kurzes Aufblitzen der ganzen Seite. Am Zeitstempel statt an animationend
	// entschieden -- das Event bleibt in einem Hintergrund-Tab aus
	// (docs/pitfalls/designsystem.md).
	const flash = $derived(timer.restDoneAt > 0 && timer.now - timer.restDoneAt < 1200);
</script>

{#if flash}
	<div class="flash bg-primary pointer-events-none fixed inset-0 z-40" aria-hidden="true"></div>
{/if}

{#if timer.restEnd > 0}
	<div class="bg-background/95 safe-b fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur">
		<div class="bg-muted h-1.5 w-full">
			<div class="bg-primary h-full" style="width: {restFraction() * 100}%"></div>
		</div>
		<div class="mx-auto flex w-full max-w-2xl items-center gap-2 px-3 py-2">
			<TimerIcon class="text-muted-foreground size-5 shrink-0" />
			<div class="min-w-0 flex-1">
				<p
					class="text-2xl leading-none font-semibold tabular-nums {ending
						? 'text-primary motion-safe:animate-pulse'
						: ''}"
					role="timer"
				>
					{formatDuration(left)}
				</p>
				<p class="text-muted-foreground text-xs">Satzpause</p>
			</div>
			<Button
				variant="ghost"
				size="icon"
				class="text-muted-foreground size-11"
				aria-label="Ton am Ende der Pause"
				aria-pressed={timer.sound}
				onclick={toggleSound}
			>
				{#if timer.sound}<Volume2Icon class="size-5" />{:else}<VolumeXIcon class="size-5" />{/if}
			</Button>
			<Button variant="outline" class="h-11 touch-manipulation" onclick={() => addRest(15)}>
				+15 s
			</Button>
			<Button variant="secondary" class="h-11" onclick={skipRest}>Überspringen</Button>
		</div>
	</div>
{:else if timer.restDoneAt > 0}
	<div
		class="bg-primary text-primary-foreground safe-b fixed inset-x-0 bottom-0 z-30 shadow-lg"
		role="alert"
	>
		<div class="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-4">
			<BellRingIcon class="size-7 shrink-0 motion-safe:animate-bounce" />
			<div class="min-w-0 flex-1">
				<p class="text-xl leading-tight font-bold">Pause vorbei!</p>
				<p class="text-sm opacity-90">Weiter mit dem nächsten Satz.</p>
			</div>
			<Button
				variant="secondary"
				class="h-11 min-w-20 font-semibold"
				onclick={skipRest}
			>
				OK
			</Button>
		</div>
	</div>
{/if}

<style>
	.flash {
		opacity: 0;
		animation: rest-flash 1.2s ease-out;
	}

	@keyframes rest-flash {
		0%,
		30% {
			opacity: 0.35;
		}
		100% {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.flash {
			display: none;
		}
	}
</style>
