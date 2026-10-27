<script>
	import { page } from '$app/state';
	import { cardio } from '$lib/cardio.svelte.js';

	// Unterrubrik von "Eintragen": Krafttraining (Vorgabe, /training) oder
	// Cardio (/training/cardio). Laeuft eine Aufzeichnung, zeigt ein Punkt das an.
	const MODES = [
		{ href: '/training', label: 'Krafttraining' },
		{ href: '/training/cardio', label: 'Cardio' }
	];

	const recording = $derived(!!cardio.run && !cardio.run.stoppedAt);
</script>

<nav aria-label="Art des Trainings" class="grid grid-cols-2 gap-1 rounded-lg border p-1">
	{#each MODES as mode (mode.href)}
		{@const active = page.url.pathname === mode.href}
		<a
			href={mode.href}
			aria-current={active ? 'page' : undefined}
			class="flex h-11 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium transition-colors {active
				? 'bg-primary text-primary-foreground'
				: 'text-muted-foreground hover:text-foreground'}"
		>
			{mode.label}
			{#if mode.href === '/training/cardio' && recording}
				<span class="size-2 rounded-full bg-red-600" aria-label="Aufzeichnung läuft"></span>
			{/if}
		</a>
	{/each}
</nav>
