<script>
	import '../app.css';
	import { goto, onNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { auth, session } from '$lib/pocketbase.svelte.js';
	import { households, syncHouseholds } from '$lib/households.svelte.js';
	import { syncCategories } from '$lib/categories.svelte.js';
	import Nav from '$lib/Nav.svelte';
	import QuickNav from '$lib/QuickNav.svelte';
	import Dragon from '$lib/Dragon.svelte';

	let { children } = $props();

	const onLogin = $derived(page.url.pathname === '/login');

	// Seiten, die ohne Haushalt auskommen: der Ideen-Feed und "Muessen wir mal
	// machen" sind app-weit, und das Profil braucht man auch dann, wenn noch
	// niemand einen zugeordnet hat. Der Trainingsplan gehoert einer Person,
	// nicht einem Haushalt.
	const OPEN_PATHS = ['/ideen', '/profile', '/zusammen'];
	const needsHousehold = $derived(
		!OPEN_PATHS.includes(page.url.pathname) &&
			page.url.pathname !== '/training' &&
			!page.url.pathname.startsWith('/training/') &&
			!page.url.pathname.startsWith('/zusammen/')
	);

	// Nur die ID, nicht `auth.user`: der Record wird bei jedem Profil-Update neu
	// gesetzt, und der Effekt soll dann nicht die Haushalte neu laden.
	const userId = $derived(auth.valid ? (auth.user?.id ?? '') : '');

	// Seitenwechsel per View Transitions API ueberblenden (Animation in app.css).
	// Ohne Unterstuetzung oder bei "Bewegung reduzieren" wechselt die Seite hart.
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});

	// Wer ausgeloggt einen Deeplink oeffnet (geteilter Link auf einen Eintrag)
	// oder dessen Sitzung abgelaufen ist, landet nach dem Login dort statt auf
	// der Startseite -- nach einem bewussten Logout nicht (`session.loggedOut`).
	// Nur eigene Pfade, und welcher Host gemeint ist, sagt verlaesslich erst der
	// URL-Parser ("/%09/example.com" wird dort zu "//example.com").
	function nextPath(value) {
		if (!value) return '/';
		try {
			const url = new URL(value, location.origin);
			return url.origin === location.origin ? url.pathname + url.search : '/';
		} catch {
			return '/';
		}
	}

	$effect(() => {
		if (!auth.valid && !onLogin) {
			const here = page.url.pathname + page.url.search;
			const plain = here === '/' || session.loggedOut;
			goto(plain ? '/login' : `/login?next=${encodeURIComponent(here)}`, {
				replaceState: true
			});
		}
		if (auth.valid && onLogin) goto(nextPath(page.url.searchParams.get('next')), { replaceState: true });
	});

	$effect(() => {
		if (!userId) return;
		return syncHouseholds(userId);
	});

	// Kategorien des aktiven Haushalts: der Zettel und die Einstellungen lesen
	// beide daraus, deshalb eine Subscription hier statt je Seite.
	$effect(() => {
		const household = households.activeId;
		if (!userId || !household) return;
		return syncCategories(household);
	});
</script>

{#if onLogin}
	{@render children()}
{:else}
	<!-- Rahmen samt Navigation gilt fuer alle angemeldeten Seiten. Die untere
	     Safe-Area haelt QuickNav frei, mit oder ohne Leiste. -->
	<div class="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
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
		<QuickNav />
		<!-- Osterei. Liegt `fixed` ueber allem und faengt keinen Tap ab. -->
		<Dragon />
	</div>
{/if}
