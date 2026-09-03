<script>
	import '../app.css';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { auth } from '$lib/pocketbase.svelte.js';

	let { children } = $props();

	$effect(() => {
		const onLogin = page.url.pathname === '/login';
		if (!auth.valid && !onLogin) goto('/login', { replaceState: true });
		if (auth.valid && onLogin) goto('/', { replaceState: true });
	});
</script>

{@render children()}
