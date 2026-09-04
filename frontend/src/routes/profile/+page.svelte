<script>
	import { auth, avatarUrl, updateProfile } from '$lib/pocketbase.svelte.js';

	// PocketBase-Default fuer Dateifelder; der Server antwortet sonst mit 400.
	const MAX_BYTES = 5 * 1024 * 1024;
	// mimeTypes des `avatar`-Feldes -- alles andere lehnt PocketBase ab.
	const ALLOWED = ['image/jpeg', 'image/png', 'image/svg+xml', 'image/gif', 'image/webp'];

	let name = $state(auth.user?.name ?? '');
	let picked = $state(null); // gewaehltes Foto, noch nicht gespeichert
	let drop = $state(false); // beim Speichern das vorhandene Foto loeschen
	let input; // <input type="file">, zum Zuruecksetzen nach dem Speichern
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
</script>

<main class="profile">
	<form onsubmit={submit}>
		<div class="photo">
			{#if shown}
				<img class="avatar xl" src={shown} alt="Profilfoto" />
			{:else}
				<span class="avatar xl fallback">{initial}</span>
			{/if}

			<div class="photo-actions">
				<label class="filebtn">
					Foto wählen
					<input
						bind:this={input}
						type="file"
						accept="image/*"
						onchange={pick}
						aria-label="Profilfoto wählen"
					/>
				</label>
				{#if shown}
					<button type="button" class="linkish" onclick={removePhoto}>Foto entfernen</button>
				{/if}
			</div>
		</div>

		<label class="field">
			Name
			<input
				type="text"
				bind:value={name}
				oninput={() => (saved = false)}
				maxlength="100"
				autocomplete="name"
				placeholder="z.B. Mama"
			/>
		</label>

		<p class="hint">Angemeldet als {auth.user?.email ?? ''}</p>

		{#if error}
			<div class="error">{error}</div>
		{/if}
		{#if saved}
			<div class="ok">Gespeichert.</div>
		{/if}

		<button type="submit" class="primary" disabled={busy || !dirty}>
			{busy ? 'Speichern …' : 'Speichern'}
		</button>
	</form>
</main>
