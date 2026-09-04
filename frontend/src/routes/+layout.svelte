<script>
	import '../app.css';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { auth } from '$lib/pocketbase.svelte.js';
	import Nav from '$lib/Nav.svelte';
	import Dragon from '$lib/Dragon.svelte';

	let { children } = $props();

	const onLogin = $derived(page.url.pathname === '/login');

	$effect(() => {
		if (!auth.valid && !onLogin) goto('/login', { replaceState: true });
		if (auth.valid && onLogin) goto('/', { replaceState: true });
	});
</script>

{#if onLogin}
	{@render children()}
{:else}
	<!-- Rahmen samt Navigation gilt fuer alle angemeldeten Seiten. -->
	<div class="safe-b mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
		<Nav />
		{@render children()}
		<!-- Osterei. Liegt `fixed` ueber allem und faengt keinen Tap ab. -->
		<Dragon />
	</div>
{/if}
