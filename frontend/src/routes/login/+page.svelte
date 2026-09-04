<script>
	import AlertCircleIcon from '@lucide/svelte/icons/circle-alert';
	import { login } from '$lib/pocketbase.svelte.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

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
			error =
				err?.status === 400
					? 'E-Mail oder Passwort falsch.'
					: (err?.message ?? 'Login fehlgeschlagen');
		} finally {
			busy = false;
		}
	}
</script>

<main class="flex min-h-dvh items-center justify-center px-4 py-6">
	<Card.Root class="w-full max-w-sm">
		<form class="flex flex-col gap-(--card-spacing)" onsubmit={submit}>
			<Card.Header>
				<Card.Title class="text-xl">Familien-Einkauf</Card.Title>
				<Card.Description>Melde dich mit deinem Familien-Account an.</Card.Description>
			</Card.Header>

			<Card.Content class="flex flex-col gap-4">
				<div class="grid gap-2">
					<Label for="email">E-Mail</Label>
					<Input
						id="email"
						type="email"
						bind:value={email}
						autocomplete="username"
						inputmode="email"
						required
						class="h-11"
					/>
				</div>

				<div class="grid gap-2">
					<Label for="password">Passwort</Label>
					<Input
						id="password"
						type="password"
						bind:value={password}
						autocomplete="current-password"
						required
						class="h-11"
					/>
				</div>

				{#if error}
					<Alert.Root variant="destructive">
						<AlertCircleIcon />
						<Alert.Description>{error}</Alert.Description>
					</Alert.Root>
				{/if}
			</Card.Content>

			<Card.Footer>
				<Button type="submit" size="lg" class="h-11 w-full" disabled={busy}>
					{busy ? 'Anmelden …' : 'Anmelden'}
				</Button>
			</Card.Footer>
		</form>
	</Card.Root>
</main>
