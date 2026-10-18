<script>
	import { page } from '$app/state';

	// Umschalter zwischen den Trainingsseiten; die Einstellungen haengen am
	// Zahnrad der Eintragsseite, der Verlauf einer Uebung an ihrem Namen.
	const TABS = [
		{ href: '/training', label: 'Eintragen' },
		{ href: '/training/kalender', label: 'Kalender' },
		{ href: '/training/koerpergewicht', label: 'Körpergewicht' }
	];
</script>

<nav aria-label="Training" class="bg-muted grid grid-cols-3 gap-1 rounded-lg p-1">
	{#each TABS as tab (tab.href)}
		{@const active = page.url.pathname === tab.href}
		<a
			href={tab.href}
			aria-current={active ? 'page' : undefined}
			class="flex h-11 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors {active
				? 'bg-background text-foreground shadow-sm'
				: 'text-muted-foreground hover:text-foreground'}"
		>
			{tab.label}
		</a>
	{/each}
</nav>
