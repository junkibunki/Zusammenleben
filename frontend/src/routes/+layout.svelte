<script>
	import '../app.css';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { auth } from '$lib/pocketbase.svelte.js';
	import { households, syncHouseholds } from '$lib/households.svelte.js';
	import Nav from '$lib/Nav.svelte';
	import Dragon from '$lib/Dragon.svelte';

	let { children } = $props();

	const onLogin = $derived(page.url.pathname === '/login');

	// Seiten, die ohne Haushalt auskommen: der Ideen-Feed ist app-weit, und das
	// Profil braucht man auch dann, wenn noch niemand einen zugeordnet hat.
	const OPEN_PATHS = ['/ideen', '/profile'];
	const needsHousehold = $derived(!OPEN_PATHS.includes(page.url.pathname));

	// Nur die ID, nicht `auth.user`: der Record wird bei jedem Profil-Update neu
	// gesetzt, und der Effekt soll dann nicht die Haushalte neu laden.
	const userId = $derived(auth.valid ? (auth.user?.id ?? '') : '');

	$effect(() => {
		if (!auth.valid && !onLogin) goto('/login', { replaceState: true });
		if (auth.valid && onLogin) goto('/', { replaceState: true });
	});

	$effect(() => {
		if (!userId) return;
		return syncHouseholds(userId);
	});
</script>

{#if onLogin}
	{@render children()}
{:else}
	<!-- Rahmen samt Navigation gilt fuer alle angemeldeten Seiten. -->
	<div class="safe-b mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
		<Nav />
		{#if !needsHousehold || households.activeId}
			{@render children()}
		{:else if households.loading}
			<p class="text-muted-foreground py-12 text-center text-sm">Lade …</p>
		{:else}
			<main class="flex-1 px-3 pt-3 pb-8">
				<div class="text-muted-foreground flex flex-col items-center gap-2 py-12 text-center text-sm">
					<p class="text-foreground font-medium">
						{households.error ?? 'Du gehörst noch zu keinem Haushalt.'}
					</p>
					{#if !households.error}
						<p>Bitte den Admin, dich einem Haushalt zuzuordnen.</p>
					{/if}
				</div>
			</main>
		{/if}
		<!-- Osterei. Liegt `fixed` ueber allem und faengt keinen Tap ab. -->
		<Dragon />
	</div>
{/if}
