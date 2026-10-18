<script>
	import TimerIcon from '@lucide/svelte/icons/timer';
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';
	import { formatDuration } from '$lib/training.svelte.js';
	import { timer, addRest, skipRest, restLeft, restFraction } from '$lib/training-timer.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';

	// Leiste unten mit der laufenden Satzpause. Liegt `fixed` und bringt die
	// Safe-Area selbst mit; die Seite haelt unten Platz frei, solange sie steht.
</script>

{#if timer.restEnd > 0 || timer.restDoneAt > 0}
	<div class="bg-background/95 safe-b fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur">
		{#if timer.restEnd > 0}
			<div class="bg-muted h-1 w-full">
				<div class="bg-primary h-full" style="width: {restFraction() * 100}%"></div>
			</div>
		{/if}
		<div class="mx-auto flex w-full max-w-2xl items-center gap-2 px-3 py-2">
			{#if timer.restEnd > 0}
				<TimerIcon class="text-muted-foreground size-5 shrink-0" />
				<div class="min-w-0 flex-1">
					<p class="text-2xl leading-none font-semibold tabular-nums" role="timer">
						{formatDuration(restLeft())}
					</p>
					<p class="text-muted-foreground text-xs">Satzpause</p>
				</div>
				<Button variant="outline" class="h-11 touch-manipulation" onclick={() => addRest(15)}>
					+15 s
				</Button>
				<Button variant="secondary" class="h-11" onclick={skipRest}>Überspringen</Button>
			{:else}
				<CheckIcon class="text-primary size-5 shrink-0" />
				<p class="flex-1 font-semibold" role="status">Pause vorbei</p>
				<Button
					variant="ghost"
					size="icon"
					class="size-11"
					aria-label="Hinweis schließen"
					onclick={skipRest}
				>
					<XIcon />
				</Button>
			{/if}
		</div>
	</div>
{/if}
