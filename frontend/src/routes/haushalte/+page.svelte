<script>
	import CheckIcon from '@lucide/svelte/icons/check';
	import HouseIcon from '@lucide/svelte/icons/house';
	import { households, setActiveHousehold } from '$lib/households.svelte.js';
	import { formatDate } from '$lib/items.svelte.js';
	import { Badge } from '$lib/components/ui/badge/index.js';

	// Alle Haushalte, denen man gerade angehoert; ein Tipp macht einen davon zum
	// aktiven. Die Seiten laden danach selbst neu (sie haengen an `activeId`).
	// Zugeordnet wird im Admin-UI, hier gibt es nichts anzulegen.

	/** "bis 3. Oktober 2026" bzw. "unbefristet"; leer fuer den Haupthaushalt. */
	function guestNote(h) {
		if (h.role !== 'gast') return '';
		return h.until ? `bis ${formatDate(h.until)}` : 'unbefristet';
	}
</script>

<main class="flex-1 px-3 pt-3 pb-8">
	<p class="text-muted-foreground mb-1.5 px-1 text-xs font-medium tracking-wide uppercase">
		{households.list.length}
		{households.list.length === 1 ? 'Haushalt' : 'Haushalte'}
	</p>
	<ul class="bg-card divide-y overflow-hidden rounded-lg border" role="radiogroup" aria-label="Aktiver Haushalt">
		{#each households.list as h (h.id)}
			{@const active = h.id === households.activeId}
			{@const note = guestNote(h)}
			<li role="none">
				<button
					type="button"
					role="radio"
					aria-checked={active}
					class="hover:bg-muted/50 flex min-h-14 w-full items-center gap-3 px-3 py-3 text-left transition-colors"
					onclick={() => setActiveHousehold(h.id)}
				>
					<HouseIcon class="text-muted-foreground size-5 shrink-0" />
					<span class="min-w-0 flex-1">
						<span class="flex items-center gap-2">
							<span class="truncate {active ? 'font-semibold' : ''}">{h.name}</span>
							{#if h.role === 'gast'}
								<Badge variant="outline" class="shrink-0">Gast</Badge>
							{:else}
								<Badge variant="secondary" class="shrink-0">Haupthaushalt</Badge>
							{/if}
						</span>
						<span class="text-muted-foreground block truncate text-xs">
							{[note, `Auto: ${h.carName}`].filter(Boolean).join(' · ')}
						</span>
					</span>
					{#if active}
						<CheckIcon class="text-primary size-5 shrink-0" aria-hidden="true" />
					{/if}
				</button>
			</li>
		{/each}
	</ul>
</main>
