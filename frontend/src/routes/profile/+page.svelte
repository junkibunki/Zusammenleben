<script>
	import { browser } from '$app/environment';
	import ImageIcon from '@lucide/svelte/icons/image';
	import CheckIcon from '@lucide/svelte/icons/check';
	import AlertCircleIcon from '@lucide/svelte/icons/circle-alert';
	import BellIcon from '@lucide/svelte/icons/bell';
	import BellOffIcon from '@lucide/svelte/icons/bell-off';
	import { auth, avatarUrl, updateProfile } from '$lib/pocketbase.svelte.js';
	import { push, refreshPush, enablePush, disablePush, sendTestPush } from '$lib/push.svelte.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	// PocketBase-Default fuer Dateifelder; der Server antwortet sonst mit 400.
	const MAX_BYTES = 5 * 1024 * 1024;
	// mimeTypes des `avatar`-Feldes -- alles andere lehnt PocketBase ab.
	const ALLOWED = ['image/jpeg', 'image/png', 'image/svg+xml', 'image/gif', 'image/webp'];

	let name = $state(auth.user?.name ?? '');
	let picked = $state(null); // gewaehltes Foto, noch nicht gespeichert
	let drop = $state(false); // beim Speichern das vorhandene Foto loeschen
	let input; // <input type="file">, per Button ausgeloest und zurueckgesetzt
	let busy = $state(false);
	let error = $state('');
	let saved = $state(false);

	// Vorschau des lokal gewaehlten Fotos; die Blob-URL wieder freigeben.
	let preview = $state('');
	$effect(() => {
		if (!picked) {
			preview = '';
			return;
		}
		const url = URL.createObjectURL(picked);
		preview = url;
		return () => URL.revokeObjectURL(url);
	});

	const shown = $derived(preview || (drop ? '' : avatarUrl(auth.user)));
	const initial = $derived(
		(auth.user?.name || auth.user?.email || '?').trim().charAt(0).toUpperCase()
	);
	const dirty = $derived(picked !== null || drop || name.trim() !== (auth.user?.name ?? ''));

	/**
	 * Fotos auf 512px verkleinern. Ein Handybild sprengt sonst das 5-MB-Limit,
	 * und fuer ein Profilbild ist ohnehin nichts davon zu sehen.
	 */
	async function shrink(file) {
		// SVG hat keine Pixelgroesse, an der sich sinnvoll drehen liesse.
		if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file;

		try {
			const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
			const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));

			// Klein genug: Original behalten, statt es unnoetig neu zu codieren.
			if (scale === 1 && file.size <= MAX_BYTES) {
				bitmap.close();
				return file;
			}

			const canvas = document.createElement('canvas');
			canvas.width = Math.round(bitmap.width * scale);
			canvas.height = Math.round(bitmap.height * scale);

			const ctx = canvas.getContext('2d');
			// JPEG kennt kein Alpha -- ohne weissen Grund wird jede transparente
			// Flaeche schwarz, aus einem Logo-Avatar also ein schwarzer Klotz.
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
			bitmap.close();

			const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
			return blob ? new File([blob], 'avatar.jpg', { type: 'image/jpeg' }) : file;
		} catch {
			return file; // z.B. HEIC, das der Browser nicht dekodiert
		}
	}

	/** PocketBase nennt den echten Grund erst in `response.data.<feld>.message`. */
	function reason(err) {
		const data = err?.response?.data ?? {};
		if (data.avatar?.message) return `Foto abgelehnt: ${data.avatar.message}`;
		if (data.name?.message) return `Name abgelehnt: ${data.name.message}`;
		const first = Object.values(data).find((v) => v?.message);
		return first?.message ?? err?.message ?? 'Speichern fehlgeschlagen';
	}

	function reset() {
		if (input) input.value = '';
	}

	async function pick(event) {
		const file = event.currentTarget.files?.[0];
		saved = false;
		error = '';
		if (!file) return;

		const small = await shrink(file);
		if (!ALLOWED.includes(small.type)) {
			error = 'Dieses Bildformat lässt sich nicht verarbeiten. Bitte JPEG oder PNG wählen.';
			reset();
			return;
		}
		if (small.size > MAX_BYTES) {
			error = 'Das Bild ist zu groß (max. 5 MB).';
			reset();
			return;
		}
		picked = small;
		drop = false;
	}

	function removePhoto() {
		picked = null;
		reset();
		drop = Boolean(auth.user?.avatar);
		saved = false;
	}

	async function submit(event) {
		event.preventDefault();
		if (busy) return;
		busy = true;
		error = '';
		saved = false;
		try {
			await updateProfile({
				name: name.trim(),
				avatar: picked ?? (drop ? null : undefined)
			});
			picked = null;
			drop = false;
			reset();
			saved = true;
		} catch (err) {
			error = reason(err);
		} finally {
			busy = false;
		}
	}

	// --- Benachrichtigungen ---

	// Auf dem iPhone gibt es Web Push nur in der installierten PWA. Im
	// Safari-Tab fehlt PushManager einfach, ohne jeden Hinweis warum.
	const onIOS = browser && /iPhone|iPad|iPod/.test(navigator.userAgent);
	let probe = $state('');

	// Holt den tatsaechlichen Zustand aus Browser und Server. Liest bewusst
	// nichts aus `push`: was ein $effect liest, darf sein eigener Ablauf nicht
	// schreiben.
	$effect(() => {
		refreshPush();
	});

	async function probePush() {
		probe = '';
		const result = await sendTestPush();
		if (!result) return;
		probe =
			result.sent > 0
				? `Verschickt an ${result.sent} von ${result.subscriptions} Gerät(en).`
				: 'Kein Gerät hat die Nachricht angenommen.';
	}
</script>

<main class="flex flex-1 flex-col gap-4 px-3 py-4">
	<Card.Root>
		<form class="flex flex-col gap-(--card-spacing)" onsubmit={submit}>
			<Card.Header>
				<Card.Title>Mein Profil</Card.Title>
				<Card.Description>Angemeldet als {auth.user?.email ?? ''}</Card.Description>
			</Card.Header>

			<Card.Content class="flex flex-col gap-6">
				<div class="flex items-center gap-4">
					<Avatar.Root class="size-20 text-2xl">
						{#if shown}
							<Avatar.Image src={shown} alt="Profilfoto" />
						{/if}
						<Avatar.Fallback>{initial}</Avatar.Fallback>
					</Avatar.Root>

					<div class="flex flex-col items-start gap-1">
						<!-- Der Button loest das versteckte Feld aus: so bleibt genau ein
						     fokussierbares Element, und die Tastatur kommt an den Dialog. -->
						<Button type="button" variant="outline" size="lg" class="h-11" onclick={() => input?.click()}>
							<ImageIcon class="size-4" />
							Foto wählen
						</Button>
						<input
							bind:this={input}
							type="file"
							accept="image/*"
							onchange={pick}
							class="hidden"
							tabindex="-1"
							aria-hidden="true"
						/>
						{#if shown}
							<Button
								type="button"
								variant="ghost"
								size="sm"
								class="text-destructive hover:text-destructive h-11"
								onclick={removePhoto}
							>
								Foto entfernen
							</Button>
						{/if}
					</div>
				</div>

				<div class="grid gap-2">
					<Label for="profile-name">Name</Label>
					<Input
						id="profile-name"
						type="text"
						bind:value={name}
						oninput={() => (saved = false)}
						maxlength={100}
						autocomplete="name"
						placeholder="z.B. Mama"
						class="h-11"
					/>
					<p class="text-muted-foreground text-xs">
						Dieser Name steht an den Einträgen, die du hinzufügst oder abhakst.
					</p>
				</div>

				{#if error}
					<Alert.Root variant="destructive">
						<AlertCircleIcon />
						<Alert.Description>{error}</Alert.Description>
					</Alert.Root>
				{/if}
				{#if saved}
					<Alert.Root>
						<CheckIcon />
						<Alert.Description>Gespeichert.</Alert.Description>
					</Alert.Root>
				{/if}
			</Card.Content>

			<Card.Footer>
				<Button type="submit" size="lg" class="h-11 w-full" disabled={busy || !dirty}>
					{busy ? 'Speichern …' : 'Speichern'}
				</Button>
			</Card.Footer>
		</form>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Benachrichtigungen</Card.Title>
			<Card.Description>
				Schreibt jemand etwas auf den Zettel oder trägt eine Ausgabe ein, meldet sich dieses
				Gerät — auch wenn die App geschlossen ist.
			</Card.Description>
		</Card.Header>

		<Card.Content class="flex flex-col gap-4">
			{#if !push.supported}
				<Alert.Root>
					<AlertCircleIcon />
					<Alert.Description>
						{#if onIOS}
							Auf dem iPhone gibt es Benachrichtigungen nur in der installierten App: in Safari
							über „Teilen“ → „Zum Home-Bildschirm“ hinzufügen und diese Seite dort erneut
							öffnen.
						{:else}
							Dieser Browser kann keine Benachrichtigungen empfangen.
						{/if}
					</Alert.Description>
				</Alert.Root>
			{:else if push.permission === 'denied'}
				<Alert.Root variant="destructive">
					<AlertCircleIcon />
					<Alert.Description>
						Benachrichtigungen sind für diese Seite blockiert. Das lässt sich nur in den
						Einstellungen des Browsers wieder erlauben.
					</Alert.Description>
				</Alert.Root>
			{:else}
				<p class="text-muted-foreground text-sm">
					{push.enabled
						? 'Auf diesem Gerät eingeschaltet.'
						: 'Auf diesem Gerät ausgeschaltet. Andere Geräte bleiben davon unberührt.'}
				</p>

				<div class="flex flex-wrap gap-2">
					{#if push.enabled}
						<Button
							variant="outline"
							size="lg"
							class="h-11"
							disabled={push.busy}
							onclick={disablePush}
						>
							<BellOffIcon class="size-4" />
							Ausschalten
						</Button>
						<Button variant="ghost" size="lg" class="h-11" disabled={push.busy} onclick={probePush}>
							Probe senden
						</Button>
					{:else}
						<Button size="lg" class="h-11" disabled={push.busy} onclick={enablePush}>
							<BellIcon class="size-4" />
							Einschalten
						</Button>
					{/if}
				</div>
			{/if}

			{#if push.error}
				<Alert.Root variant="destructive">
					<AlertCircleIcon />
					<Alert.Description>{push.error}</Alert.Description>
				</Alert.Root>
			{/if}
			{#if probe}
				<Alert.Root>
					<CheckIcon />
					<Alert.Description>{probe}</Alert.Description>
				</Alert.Root>
			{/if}
		</Card.Content>
	</Card.Root>
</main>
