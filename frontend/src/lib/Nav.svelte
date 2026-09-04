<script>
	import { fade, fly } from 'svelte/transition';
	import { page } from '$app/state';
	import { auth, logout, avatarUrl } from '$lib/pocketbase.svelte.js';

	// `title` steht in der Leiste, `label` im Menue -- die Startseite heisst dort
	// nach ihrem Inhalt, oben aber weiter nach der App.
	const LINKS = [
		{ href: '/', label: 'Einkaufszettel', title: 'Familien-Einkauf', icon: '🛒' },
		{ href: '/profile', label: 'Profil', title: 'Profil', icon: '👤' }
	];

	let open = $state(false);
	let burger; // fuer die Fokus-Rueckgabe beim Schliessen
	// $state, weil der $effect unten darauf reagieren muss, sobald bind:this greift.
	let drawer = $state(null);

	// Jede Navigation schliesst die Schublade -- auch Zurueck/Vorwaerts.
	$effect(() => {
		page.url.pathname;
		open = false;
	});

	// Beim Oeffnen den Fokus in die Schublade holen, damit Tab dort landet.
	$effect(() => {
		drawer?.focus();
	});

	function close() {
		open = false;
		burger?.focus();
	}

	const title = $derived(
		LINKS.find((l) => l.href === page.url.pathname)?.title ?? 'Familien-Einkauf'
	);
	const photo = $derived(avatarUrl(auth.user));
	const label = $derived(auth.user?.name || auth.user?.email?.split('@')[0] || '');
	const initial = $derived((label || '?').charAt(0).toUpperCase());
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && open && close()} />

<header class="topbar">
	<button
		bind:this={burger}
		class="burger"
		aria-label="Menü öffnen"
		aria-expanded={open}
		aria-controls={open ? 'nav-drawer' : undefined}
		onclick={() => (open = true)}
	>
		<span></span><span></span><span></span>
	</button>
	<h1>{title}</h1>
	{#if photo}
		<img class="avatar sm" src={photo} alt="" />
	{:else if initial !== '?'}
		<span class="avatar sm fallback">{initial}</span>
	{/if}
</header>

{#if open}
	<button
		class="scrim"
		aria-label="Menü schließen"
		onclick={close}
		transition:fade={{ duration: 120 }}
	></button>

	<nav
		bind:this={drawer}
		id="nav-drawer"
		class="drawer"
		tabindex="-1"
		transition:fly={{ x: -300, duration: 180 }}
	>
		<div class="who">
			{#if photo}
				<img class="avatar lg" src={photo} alt="" />
			{:else}
				<span class="avatar lg fallback">{initial}</span>
			{/if}
			<div class="who-text">
				<strong>{label || 'Ohne Namen'}</strong>
				<span>{auth.user?.email ?? ''}</span>
			</div>
		</div>

		{#each LINKS as link (link.href)}
			<a href={link.href} class:active={page.url.pathname === link.href}>
				<span class="icon" aria-hidden="true">{link.icon}</span>{link.label}
			</a>
		{/each}

		<button class="signout" onclick={logout}>
			<span class="icon" aria-hidden="true">🚪</span>Abmelden
		</button>
	</nav>
{/if}
