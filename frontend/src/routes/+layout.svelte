<script>
	import '../app.css';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { auth } from '$lib/pocketbase.svelte.js';
	import Nav from '$lib/Nav.svelte';

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
	<div class="app">
		<Nav />
		{@render children()}
	</div>
{/if}
