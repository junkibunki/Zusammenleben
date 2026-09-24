<script>
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import { activeHousehold, setCarName, CAR_NAME_MAX } from '$lib/households.svelte.js';
	import {
		categories,
		orderedCategories,
		addCategory,
		renameCategory,
		deleteCategory,
		moveCategory,
		categoryError,
		CATEGORY_MAX,
		NO_CATEGORY
	} from '$lib/categories.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';

	// Einstellungen des *aktiven* Haushalts. Aendern duerfen nur Haupt-Mitglieder
	// (die Rules in Migration 1789477200 sperren Gaeste ohnehin); das Menue zeigt
	// die Seite Gaesten gar nicht, wer sie direkt aufruft, sieht sie nur lesend.
	const current = $derived(activeHousehold());
	const canEdit = $derived(current?.role === 'haupt');
	const ordered = $derived(orderedCategories());

	// --- Auto ---------------------------------------------------------------

	// Ein String-$derived feuert nur bei geaendertem Wert: jedes Realtime-Event
	// laedt `households.list` neu, und das soll den Entwurf nicht ueberschreiben.
	const savedCar = $derived(current?.carName ?? '');
	let carDraft = $state('');
	let carBusy = $state(false);
	let carError = $state(null);
	let carSaved = $state(false);

	$effect(() => {
		carDraft = savedCar;
	});

	const carDirty = $derived(carDraft.trim() !== '' && carDraft.trim() !== savedCar);

	async function saveCar(e) {
		e.preventDefault();
		if (!current || !carDirty) return;
		carBusy = true;
		carError = null;
		carSaved = false;
		try {
			await setCarName(current.id, carDraft);
			carSaved = true;
		} catch (err) {
			carError = err?.message ?? 'Speichern fehlgeschlagen';
		} finally {
			carBusy = false;
		}
	}

	// --- Kategorien ---------------------------------------------------------

	let draft = $state('');
	let adding = $state(false);
	let error = $state(null);

	let editingId = $state('');
	let editDraft = $state('');
	let moving = $state(false);

	let confirmOpen = $state(false);
	let pending = $state(null);

	async function add(e) {
		e.preventDefault();
		if (!current || !draft.trim()) return;
		adding = true;
		error = null;
		try {
			await addCategory(current.id, draft);
			draft = '';
		} catch (err) {
			error = categoryError(err, 'Anlegen fehlgeschlagen');
		} finally {
			adding = false;
		}
	}

	function startEdit(c) {
		editingId = c.id;
		editDraft = c.name;
		error = null;
	}

	async function saveEdit(e, c) {
		e.preventDefault();
		const name = editDraft.trim();
		if (!name) return;
		if (name === c.name) {
			editingId = '';
			return;
		}
		try {
			await renameCategory(c, name);
			editingId = '';
			error = null;
		} catch (err) {
			error = categoryError(err, 'Umbenennen fehlgeschlagen');
		}
	}

	async function move(c, delta) {
		moving = true;
		error = null;
		try {
			await moveCategory(c, delta);
		} catch (err) {
			error = err?.message ?? 'Verschieben fehlgeschlagen';
		} finally {
			moving = false;
		}
	}

	function askDelete(c) {
		pending = c;
		confirmOpen = true;
	}

	async function confirmDelete() {
		// Selbst schliessen: `AlertDialog.Action` schliesst mit eigenem onclick
		// nicht von allein (docs/pitfalls/designsystem.md).
		confirmOpen = false;
		const c = pending;
		if (!c) return;
		error = null;
		try {
			await deleteCategory(c);
		} catch (err) {
			error = err?.message ?? 'Löschen fehlgeschlagen';
		}
	}
</script>

<main class="flex flex-1 flex-col gap-4 px-3 py-4">
	{#if !canEdit}
		<Alert.Root>
			<AlertCircleIcon />
			<Alert.Description>Nur Hauptbewohner können die Einstellungen ändern.</Alert.Description>
		</Alert.Root>
	{/if}

	<Card.Root>
		<form class="flex flex-col gap-(--card-spacing)" onsubmit={saveCar}>
			<Card.Header>
				<Card.Title>Auto</Card.Title>
				<Card.Description>So heißt das Auto auf der Seite „Wo ist …“.</Card.Description>
			</Card.Header>

			<Card.Content class="flex flex-col gap-4">
				<div class="grid gap-2">
					<Label for="car-name">Name des Autos</Label>
					<Input
						id="car-name"
						type="text"
						bind:value={carDraft}
						oninput={() => (carSaved = false)}
						maxlength={CAR_NAME_MAX}
						autocomplete="off"
						disabled={!canEdit}
						class="h-11"
					/>
				</div>

				{#if carError}
					<Alert.Root variant="destructive">
						<AlertCircleIcon />
						<Alert.Description>{carError}</Alert.Description>
					</Alert.Root>
				{/if}
				{#if carSaved}
					<Alert.Root>
						<CheckIcon />
						<Alert.Description>Gespeichert.</Alert.Description>
					</Alert.Root>
				{/if}
			</Card.Content>

			{#if canEdit}
				<Card.Footer>
					<Button type="submit" size="lg" class="h-11 w-full" disabled={carBusy || !carDirty}>
						{carBusy ? 'Speichern …' : 'Speichern'}
					</Button>
				</Card.Footer>
			{/if}
		</form>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Kategorien</Card.Title>
			<Card.Description>
				Wo eingekauft wird. In dieser Reihenfolge stehen die Gruppen auf dem Zettel.
			</Card.Description>
		</Card.Header>

		<Card.Content class="flex flex-col gap-4">
			{#if categories.loading && categories.list.length === 0}
				<p class="text-muted-foreground text-sm">Lade …</p>
			{:else if ordered.length === 0}
				<p class="text-muted-foreground text-sm">
					Noch keine Kategorien – alles steht unter „{NO_CATEGORY}“.
				</p>
			{:else}
				<ul class="divide-y overflow-hidden rounded-lg border">
					{#each ordered as c, i (c.id)}
						<li class="flex min-h-11 items-center gap-1 pl-3">
							{#if editingId === c.id}
								<form class="flex flex-1 items-center gap-1 py-1" onsubmit={(e) => saveEdit(e, c)}>
									<!-- svelte-ignore a11y_autofocus -->
									<Input
										type="text"
										bind:value={editDraft}
										maxlength={CATEGORY_MAX}
										aria-label="Neuer Name für {c.name}"
										autocomplete="off"
										autofocus
										class="h-11 flex-1"
										onkeydown={(e) => e.key === 'Escape' && (editingId = '')}
									/>
									<Button
										type="submit"
										variant="ghost"
										size="icon"
										class="size-11 shrink-0"
										aria-label="Namen speichern"
										disabled={!editDraft.trim()}
									>
										<CheckIcon class="size-4" />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										class="text-muted-foreground size-11 shrink-0"
										aria-label="Abbrechen"
										onclick={() => (editingId = '')}
									>
										<XIcon class="size-4" />
									</Button>
								</form>
							{:else}
								<span class="min-w-0 flex-1 truncate py-3">{c.name}</span>
								{#if canEdit}
									<Button
										variant="ghost"
										size="icon"
										class="text-muted-foreground size-11 shrink-0"
										aria-label="{c.name} nach oben"
										disabled={moving || i === 0}
										onclick={() => move(c, -1)}
									>
										<ChevronUpIcon class="size-4" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										class="text-muted-foreground size-11 shrink-0"
										aria-label="{c.name} nach unten"
										disabled={moving || i === ordered.length - 1}
										onclick={() => move(c, 1)}
									>
										<ChevronDownIcon class="size-4" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										class="text-muted-foreground size-11 shrink-0"
										aria-label="{c.name} umbenennen"
										onclick={() => startEdit(c)}
									>
										<PencilIcon class="size-4" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										class="text-muted-foreground hover:text-destructive size-11 shrink-0"
										aria-label="{c.name} löschen"
										onclick={() => askDelete(c)}
									>
										<Trash2Icon class="size-4" />
									</Button>
								{/if}
							{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if error || categories.error}
				<Alert.Root variant="destructive">
					<AlertCircleIcon />
					<Alert.Description>{error ?? categories.error}</Alert.Description>
				</Alert.Root>
			{/if}

			{#if canEdit}
				<form class="flex items-center gap-2" onsubmit={add}>
					<Input
						type="text"
						bind:value={draft}
						maxlength={CATEGORY_MAX}
						placeholder="Neue Kategorie"
						aria-label="Neue Kategorie"
						autocomplete="off"
						enterkeyhint="done"
						class="h-11 flex-1"
					/>
					<Button type="submit" size="lg" class="h-11 shrink-0" disabled={adding || !draft.trim()}>
						<PlusIcon class="size-4" />
						Hinzufügen
					</Button>
				</form>
			{/if}
		</Card.Content>
	</Card.Root>
</main>

<AlertDialog.Root bind:open={confirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Kategorie „{pending?.name}“ löschen?</AlertDialog.Title>
			<AlertDialog.Description>
				Die Einträge darin bleiben erhalten und stehen danach unter „{NO_CATEGORY}“.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel class="h-11">Abbrechen</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" class="h-11" onclick={confirmDelete}>
				Löschen
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
