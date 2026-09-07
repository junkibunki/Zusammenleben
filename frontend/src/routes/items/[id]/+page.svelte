<script>
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import AlertCircleIcon from '@lucide/svelte/icons/circle-alert';
	import { auth } from '$lib/pocketbase.svelte.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import {
		loadItem,
		saveItemDetails,
		userLabel,
		formatWhen,
		NOTE_MAX
	} from '$lib/items.svelte.js';

	const id = $derived(page.params.id);

	let item = $state(null);
	let name = $state('');
	let note = $state('');
	let loading = $state(true);
	let busy = $state(false);
	let error = $state('');

	// Laden. Haengt allein an der ID -- alles, was der Ablauf schreibt (`item`,
	// `name`, `note`), wird hier bewusst nicht gelesen, sonst startet der Effekt
	// sich selbst neu.
	$effect(() => {
		if (!auth.valid) return;
		const wanted = id;
		let cancelled = false;

		loading = true;
		error = '';

		loadItem(wanted)
			.then((record) => {
				if (cancelled) return;
				item = record;
				name = record.name ?? '';
				note = record.note ?? '';
				loading = false;
			})
			.catch((err) => {
				if (cancelled) return;
				error =
					err?.status === 404
						? 'Diesen Eintrag gibt es nicht mehr.'
						: (err?.message ?? 'Laden fehlgeschlagen');
				loading = false;
			});

		return () => {
			cancelled = true;
		};
	});

	const meta = $derived.by(() => {
		if (!item) return '';
		const parts = [];
		const added = userLabel(item.expand?.added_by);
		const when = formatWhen(item.created);
		if (added) parts.push(`von ${added}`);
		if (when) parts.push(when);
		return parts.join(' · ');
	});

	const dirty = $derived(
		Boolean(item) && (name.trim() !== (item.name ?? '') || note.trim() !== (item.note ?? ''))
	);
	const valid = $derived(name.trim().length > 0);

	async function submit(event) {
		event.preventDefault();
		if (busy || !item || !valid || !dirty) return;
		busy = true;
		error = '';
		try {
			await saveItemDetails(item.id, { name, note });
			// Zurueck zur Liste: gespeichert wird genau einmal, danach hat die
			// Seite keine Aufgabe mehr.
			goto('/');
		} catch (err) {
			error = err?.response?.data?.note?.message ?? err?.message ?? 'Speichern fehlgeschlagen';
			busy = false;
		}
	}
</script>

<main class="flex flex-1 flex-col gap-4 px-3 py-4">
	<div>
		<Button variant="ghost" size="lg" class="text-muted-foreground -ml-2 h-11" href="/">
			<ArrowLeftIcon class="size-4" />
			Zur Liste
		</Button>
	</div>

	{#if loading}
		<p class="text-muted-foreground py-12 text-center text-sm">Lade …</p>
	{:else if !item}
		<Alert.Root variant="destructive">
			<AlertCircleIcon />
			<Alert.Description>{error || 'Eintrag nicht gefunden.'}</Alert.Description>
		</Alert.Root>
	{:else}
		<Card.Root>
			<form class="flex flex-col gap-(--card-spacing)" onsubmit={submit}>
				<Card.Header>
					<Card.Title>Eintrag</Card.Title>
					{#if meta}
						<Card.Description>{meta}</Card.Description>
					{/if}
				</Card.Header>

				<Card.Content class="flex flex-col gap-6">
					<div class="grid gap-2">
						<Label for="item-name">Titel</Label>
						<Input
							id="item-name"
							type="text"
							bind:value={name}
							oninput={() => (error = '')}
							maxlength={200}
							autocomplete="off"
							placeholder="Was fehlt?"
							class="h-11"
						/>
					</div>

					<div class="grid gap-2">
						<Label for="item-note">Beschreibung</Label>
						<Textarea
							id="item-note"
							bind:value={note}
							oninput={() => (error = '')}
							maxlength={NOTE_MAX}
							rows={8}
							placeholder="Marke, Größe, Menge, wo im Laden — was sonst noch wichtig ist."
							class="min-h-40"
						/>
						<p class="text-muted-foreground text-xs">
							Die ersten zwei Zeilen stehen mit in der Liste. {NOTE_MAX - note.length} Zeichen frei.
						</p>
					</div>

					{#if error}
						<Alert.Root variant="destructive">
							<AlertCircleIcon />
							<Alert.Description>{error}</Alert.Description>
						</Alert.Root>
					{/if}
				</Card.Content>

				<Card.Footer>
					<Button type="submit" size="lg" class="h-11 w-full" disabled={busy || !dirty || !valid}>
						{busy ? 'Speichern …' : 'Speichern'}
					</Button>
				</Card.Footer>
			</form>
		</Card.Root>
	{/if}
</main>
