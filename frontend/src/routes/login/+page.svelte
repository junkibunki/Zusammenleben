<script>
	import { login } from '$lib/pocketbase.svelte.js';

	let email = $state('');
	let password = $state('');
	let busy = $state(false);
	let error = $state('');

	async function submit(e) {
		e.preventDefault();
		if (busy) return;
		busy = true;
		error = '';
		try {
			await login(email, password);
			// Der Redirect passiert im +layout.svelte, sobald authStore gueltig ist.
		} catch (err) {
			error = err?.status === 400 ? 'E-Mail oder Passwort falsch.' : (err?.message ?? 'Login fehlgeschlagen');
		} finally {
			busy = false;
		}
	}
</script>

<form class="login" onsubmit={submit}>
	<h1>Familien-Einkauf</h1>

	<input
		type="email"
		bind:value={email}
		placeholder="E-Mail"
		autocomplete="username"
		inputmode="email"
		required
	/>
	<input
		type="password"
		bind:value={password}
		placeholder="Passwort"
		autocomplete="current-password"
		required
	/>

	{#if error}
		<div class="error">{error}</div>
	{/if}

	<button type="submit" disabled={busy}>{busy ? 'Anmelden …' : 'Anmelden'}</button>
</form>
