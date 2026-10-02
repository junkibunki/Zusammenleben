<script>
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import {
		exercisesOf,
		renameWorkout,
		deleteWorkout,
		moveWorkout,
		addExercise,
		updateExercise,
		deleteExercise,
		moveExercise,
		trainingError,
		EXERCISE_MAX,
		WORKOUT_MAX
	} from '$lib/training.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';

	// Ein Training mit seinen Uebungen. Eigene Komponente, damit jedes Training
	// seine eigenen Entwuerfe (Umbenennen, neue Uebung) hat.
	let { workout, index, count } = $props();

	const exercises = $derived(exercisesOf(workout.id));
	const validCount = (n, max) => Number.isInteger(n) && n >= 1 && n <= max;

	let error = $state(null);
	let moving = $state(false);

	// --- Training -----------------------------------------------------------

	let renaming = $state(false);
	let nameDraft = $state('');

	function startRename() {
		nameDraft = workout.name;
		renaming = true;
		error = null;
	}

	async function saveRename(e) {
		e.preventDefault();
		const name = nameDraft.trim();
		if (!name) return;
		if (name === workout.name) {
			renaming = false;
			return;
		}
		try {
			await renameWorkout(workout, name);
			renaming = false;
			error = null;
		} catch (err) {
			error = trainingError(err, 'Umbenennen fehlgeschlagen');
		}
	}

	async function moveSelf(delta) {
		moving = true;
		error = null;
		try {
			await moveWorkout(workout, delta);
		} catch (err) {
			error = trainingError(err, 'Verschieben fehlgeschlagen');
		} finally {
			moving = false;
		}
	}

	// --- Uebungen -----------------------------------------------------------

	let newName = $state('');
	let newSets = $state(3);
	let newReps = $state(10);
	let adding = $state(false);

	let editingId = $state('');
	let editName = $state('');
	let editSets = $state(3);
	let editReps = $state(10);

	async function add(e) {
		e.preventDefault();
		if (!newName.trim() || !validCount(newSets, 20) || !validCount(newReps, 200)) return;
		adding = true;
		error = null;
		try {
			await addExercise(workout.id, { name: newName, sets: newSets, reps: newReps });
			newName = '';
		} catch (err) {
			error = trainingError(err, 'Anlegen fehlgeschlagen');
		} finally {
			adding = false;
		}
	}

	function startEdit(ex) {
		editingId = ex.id;
		editName = ex.name;
		editSets = ex.sets;
		editReps = ex.reps;
		error = null;
	}

	async function saveEdit(e, ex) {
		e.preventDefault();
		if (!editName.trim() || !validCount(editSets, 20) || !validCount(editReps, 200)) return;
		try {
			await updateExercise(ex, { name: editName, sets: editSets, reps: editReps });
			editingId = '';
			error = null;
		} catch (err) {
			error = trainingError(err, 'Speichern fehlgeschlagen');
		}
	}

	async function move(ex, delta) {
		moving = true;
		error = null;
		try {
			await moveExercise(ex, delta);
		} catch (err) {
			error = trainingError(err, 'Verschieben fehlgeschlagen');
		} finally {
			moving = false;
		}
	}

	// --- Loeschen (Training oder Uebung) -------------------------------------

	let confirmOpen = $state(false);
	let pending = $state(null); // { kind: 'workout' | 'exercise', record }

	function askDelete(kind, record) {
		pending = { kind, record };
		confirmOpen = true;
	}

	async function confirmDelete() {
		// Selbst schliessen: `AlertDialog.Action` schliesst mit eigenem onclick
		// nicht von allein (docs/pitfalls/designsystem.md).
		confirmOpen = false;
		const p = pending;
		if (!p) return;
		error = null;
		try {
			if (p.kind === 'workout') await deleteWorkout(p.record);
			else await deleteExercise(p.record);
		} catch (err) {
			error = trainingError(err, 'Löschen fehlgeschlagen');
		}
	}
</script>

<Card.Root>
	<Card.Header>
		{#if renaming}
			<form class="flex items-center gap-1" onsubmit={saveRename}>
				<!-- svelte-ignore a11y_autofocus -->
				<Input
					type="text"
					bind:value={nameDraft}
					maxlength={WORKOUT_MAX}
					aria-label="Neuer Name für {workout.name}"
					autocomplete="off"
					autofocus
					class="h-11 flex-1"
					onkeydown={(e) => e.key === 'Escape' && (renaming = false)}
				/>
				<Button
					type="submit"
					variant="ghost"
					size="icon"
					class="size-11 shrink-0"
					aria-label="Namen speichern"
					disabled={!nameDraft.trim()}
				>
					<CheckIcon class="size-4" />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="text-muted-foreground size-11 shrink-0"
					aria-label="Abbrechen"
					onclick={() => (renaming = false)}
				>
					<XIcon class="size-4" />
				</Button>
			</form>
		{:else}
			<Card.Title>{workout.name}</Card.Title>
			<Card.Description>
				{exercises.length === 1 ? '1 Übung' : `${exercises.length} Übungen`}
			</Card.Description>
		{/if}
	</Card.Header>

	<Card.Content class="flex flex-col gap-4">
		{#if exercises.length > 0}
			<ul class="divide-y overflow-hidden rounded-lg border">
				{#each exercises as ex, i (ex.id)}
					<li class="flex min-h-11 items-center gap-1 pl-3">
						{#if editingId === ex.id}
							<form class="flex flex-1 flex-col gap-2 py-2 pr-2" onsubmit={(e) => saveEdit(e, ex)}>
								<!-- svelte-ignore a11y_autofocus -->
								<Input
									type="text"
									bind:value={editName}
									maxlength={EXERCISE_MAX}
									aria-label="Name der Übung"
									autocomplete="off"
									autofocus
									class="h-11"
									onkeydown={(e) => e.key === 'Escape' && (editingId = '')}
								/>
								<div class="flex items-center gap-1.5">
									<Input
										type="number"
										inputmode="numeric"
										min="1"
										max="20"
										bind:value={editSets}
										aria-label="Sätze"
										class="h-11 w-16"
									/>
									<span class="text-muted-foreground text-sm">×</span>
									<Input
										type="number"
										inputmode="numeric"
										min="1"
										max="200"
										bind:value={editReps}
										aria-label="Wiederholungen"
										class="h-11 w-16"
									/>
									<span class="flex-1"></span>
									<Button
										type="submit"
										variant="ghost"
										size="icon"
										class="size-11 shrink-0"
										aria-label="Übung speichern"
										disabled={!editName.trim() || !validCount(editSets, 20) || !validCount(editReps, 200)}
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
								</div>
							</form>
						{:else}
							<div class="min-w-0 flex-1 py-2">
								<p class="truncate text-sm">{ex.name}</p>
								<p class="text-muted-foreground text-xs">
									{ex.sets} {ex.sets === 1 ? 'Satz' : 'Sätze'} × {ex.reps} Wdh.
								</p>
							</div>
							<Button
								variant="ghost"
								size="icon"
								class="text-muted-foreground size-11 shrink-0"
								aria-label="{ex.name} nach oben"
								disabled={moving || i === 0}
								onclick={() => move(ex, -1)}
							>
								<ChevronUpIcon class="size-4" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="text-muted-foreground size-11 shrink-0"
								aria-label="{ex.name} nach unten"
								disabled={moving || i === exercises.length - 1}
								onclick={() => move(ex, 1)}
							>
								<ChevronDownIcon class="size-4" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="text-muted-foreground size-11 shrink-0"
								aria-label="{ex.name} bearbeiten"
								onclick={() => startEdit(ex)}
							>
								<PencilIcon class="size-4" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="text-muted-foreground hover:text-destructive size-11 shrink-0"
								aria-label="{ex.name} löschen"
								onclick={() => askDelete('exercise', ex)}
							>
								<Trash2Icon class="size-4" />
							</Button>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if error}
			<Alert.Root variant="destructive">
				<AlertCircleIcon />
				<Alert.Description>{error}</Alert.Description>
			</Alert.Root>
		{/if}

		<form class="flex flex-col gap-2" onsubmit={add}>
			<Input
				type="text"
				bind:value={newName}
				maxlength={EXERCISE_MAX}
				placeholder="Neue Übung, z. B. Bankdrücken"
				aria-label="Neue Übung in {workout.name}"
				autocomplete="off"
				class="h-11"
			/>
			<div class="flex items-center gap-1.5">
				<Input
					type="number"
					inputmode="numeric"
					min="1"
					max="20"
					bind:value={newSets}
					aria-label="Sätze"
					class="h-11 w-16"
				/>
				<span class="text-muted-foreground text-sm">Sätze ×</span>
				<Input
					type="number"
					inputmode="numeric"
					min="1"
					max="200"
					bind:value={newReps}
					aria-label="Wiederholungen"
					class="h-11 w-16"
				/>
				<span class="text-muted-foreground text-sm">Wdh.</span>
				<span class="flex-1"></span>
				<Button
					type="submit"
					size="icon-lg"
					class="size-11 shrink-0"
					aria-label="Übung zu {workout.name} hinzufügen"
					disabled={adding || !newName.trim() || !validCount(newSets, 20) || !validCount(newReps, 200)}
				>
					<PlusIcon class="size-4" />
				</Button>
			</div>
		</form>
	</Card.Content>

	{#if !renaming}
		<Card.Footer class="gap-1">
			<Button
				variant="ghost"
				size="icon"
				class="text-muted-foreground size-11"
				aria-label="{workout.name} nach oben"
				disabled={moving || index === 0}
				onclick={() => moveSelf(-1)}
			>
				<ChevronUpIcon class="size-4" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="text-muted-foreground size-11"
				aria-label="{workout.name} nach unten"
				disabled={moving || index === count - 1}
				onclick={() => moveSelf(1)}
			>
				<ChevronDownIcon class="size-4" />
			</Button>
			<span class="flex-1"></span>
			<Button variant="ghost" size="lg" class="text-muted-foreground h-11" onclick={startRename}>
				<PencilIcon class="size-4" />
				Umbenennen
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="text-muted-foreground hover:text-destructive size-11"
				aria-label="{workout.name} löschen"
				onclick={() => askDelete('workout', workout)}
			>
				<Trash2Icon class="size-4" />
			</Button>
		</Card.Footer>
	{/if}
</Card.Root>

<AlertDialog.Root bind:open={confirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				{pending?.kind === 'workout' ? 'Training' : 'Übung'} „{pending?.record.name}“ löschen?
			</AlertDialog.Title>
			<AlertDialog.Description>
				{pending?.kind === 'workout'
					? 'Alle Übungen darin und ihre eingetragenen Gewichte gehen dabei verloren.'
					: 'Alle eingetragenen Gewichte dieser Übung gehen dabei verloren.'}
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
