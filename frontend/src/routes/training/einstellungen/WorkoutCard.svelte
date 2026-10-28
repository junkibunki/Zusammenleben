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
		setWorkoutShared,
		trainingError,
		kindOf,
		targetLabel,
		parseWeight,
		KINDS,
		DEFAULT_REST,
		DEFAULT_INCREMENT,
		EXERCISE_MAX,
		WORKOUT_MAX
	} from '$lib/training.svelte.js';
	import { auth } from '$lib/pocketbase.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';

	// Ein Training mit seinen Uebungen. Eigene Komponente, damit jedes Training
	// seine eigenen Entwuerfe (Umbenennen, neue Uebung) hat.
	let { workout, index, count } = $props();

	const exercises = $derived(exercisesOf(workout.id));

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

	// --- Freigabe ----------------------------------------------------------

	let sharing = $state(false);

	async function toggleShared(shared) {
		sharing = true;
		error = null;
		try {
			await setWorkoutShared(workout, shared);
		} catch (err) {
			error = trainingError(err, 'Freigeben fehlgeschlagen');
		} finally {
			sharing = false;
		}
	}

	// --- Uebungen -----------------------------------------------------------

	// Entwurf der Zahlenfelder einer Uebung. `kind` kann '' werden (das Select
	// laesst sich abwaehlen, docs/pitfalls/designsystem.md) -- gelesen wird es
	// deshalb nur ueber kindOf(). `repsMax` leer (null) = kein Bereich,
	// `increment` als Text, damit das deutsche Komma geht.
	const decimal = (v) => String(v ?? 0).replace('.', ',');

	function blankDraft() {
		return {
			kind: 'weight',
			sets: 3,
			reps: 10,
			repsMax: null,
			rest: DEFAULT_REST,
			increment: decimal(DEFAULT_INCREMENT),
			more: false
		};
	}

	function draftOf(ex) {
		return {
			kind: kindOf(ex),
			sets: ex.sets,
			reps: ex.reps,
			repsMax: ex.reps_max || null,
			rest: ex.rest ?? 0,
			increment: decimal(ex.increment),
			more: false
		};
	}

	const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
	const isEmpty = (v) => v === null || v === undefined || v === '';

	/**
	 * Prueft einen Entwurf. Liefert `{ fields }` fuer addExercise/updateExercise
	 * oder `{ error, more }`; `more` heisst, der Fehler steckt in einem Feld
	 * hinter "Mehr" -- dann klappt der Bereich auf.
	 */
	function check(d) {
		const kind = kindOf(d);
		const time = kind === 'time';
		const max = time ? 3600 : 200;
		const unit = time ? 'Sekunden' : 'Wiederholungen';
		if (!isInt(d.sets, 1, 20)) return { error: 'Sätze: bitte eine ganze Zahl von 1 bis 20.' };
		if (!isInt(d.reps, 1, max)) return { error: `${unit}: bitte eine ganze Zahl von 1 bis ${max}.` };
		const repsMax = isEmpty(d.repsMax) ? 0 : d.repsMax;
		if (repsMax !== 0 && !isInt(repsMax, d.reps, max)) {
			return {
				error: `„bis“: bitte eine ganze Zahl von ${d.reps} bis ${max} – oder leer lassen für ein festes Ziel.`
			};
		}
		const rest = isEmpty(d.rest) ? 0 : d.rest;
		if (!isInt(rest, 0, 900)) {
			return { error: 'Pause: bitte ganze Sekunden von 0 bis 900 (0 = kein Timer).', more: true };
		}
		const fields = {
			sets: d.sets,
			reps: d.reps,
			kind,
			reps_max: repsMax === d.reps ? 0 : repsMax,
			rest
		};
		// Die Steigerung gibt es nur bei Gewicht; sonst bleibt der gespeicherte
		// Wert stehen (beim Anlegen: die Vorgabe), falls die Art zurueckwechselt.
		if (kind === 'weight') {
			const inc = parseWeight(d.increment) ?? 0;
			if (Number.isNaN(inc) || inc > 50) {
				return { error: 'Steigerung: bitte eine Zahl von 0 bis 50 kg, z. B. 2,5.', more: true };
			}
			fields.increment = inc;
		}
		return { fields };
	}

	/**
	 * Zusammenfassung hinter "Mehr", z.B. "Pause 90 s". Die Steigerung bleibt
	 * draussen -- beim Eintragen sieht man sie auch nur als Vorschlag.
	 */
	function moreSummary(d) {
		return isInt(d.rest, 1, 900) ? `Pause ${d.rest} s` : 'Kein Pausen-Timer';
	}

	const kindLabel = (kind) => KINDS.find((k) => k.id === kind)?.label ?? kind;

	let newName = $state('');
	let newDraft = $state(blankDraft());
	const newCheck = $derived(check(newDraft));
	let adding = $state(false);

	let editingId = $state('');
	let editName = $state('');
	let editDraft = $state(blankDraft());
	const editCheck = $derived(check(editDraft));

	async function add(e) {
		e.preventDefault();
		if (!newName.trim() || !newCheck.fields) return;
		adding = true;
		error = null;
		try {
			await addExercise(workout.id, { name: newName, ...newCheck.fields });
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
		editDraft = draftOf(ex);
		error = null;
	}

	async function saveEdit(e, ex) {
		e.preventDefault();
		if (!editName.trim() || !editCheck.fields) return;
		try {
			await updateExercise(ex, { name: editName, ...editCheck.fields });
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
								{@render exerciseFields(editDraft, `edit-${ex.id}`, editCheck, editActions)}
							</form>
						{:else}
							<div class="min-w-0 flex-1 py-2">
								<p class="truncate text-sm">{ex.name}</p>
								<p class="text-muted-foreground text-xs">
									{targetLabel(ex)}{kindOf(ex) !== 'weight' ? ` · ${kindLabel(kindOf(ex))}` : ''}
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
			{@render exerciseFields(newDraft, `new-${workout.id}`, newCheck, addActions)}
		</form>

		<div class="flex flex-col gap-1">
			<div class="flex min-h-11 items-center gap-3">
				<Checkbox
					id="share-{workout.id}"
					bind:checked={() => !!workout.shared, (v) => toggleShared(v)}
					disabled={sharing}
				/>
				<Label for="share-{workout.id}" class="flex-1 py-3">Für andere freigeben</Label>
			</div>
			<p class="text-muted-foreground text-sm">
				{#if workout.shared && !auth.user?.show_training}
					Gerade für niemanden sichtbar: Freigaben gelten nur, solange „Training anzeigen“ im
					<a href="/profile" class="underline underline-offset-4">Profil</a> eingeschaltet ist.
				{:else}
					Alle in der App können die Übungen dieses Trainings sehen und in ihren Plan kopieren –
					deine eingetragenen Gewichte nicht.
				{/if}
			</p>
		</div>
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

<!-- Zahlenfelder einer Uebung, gemeinsam fuer Anlegen und Bearbeiten. `actions`
     sitzt rechts in der Zeile der Wdh., damit das Formular auf dem Handy kurz
     bleibt; Pause und Steigerung liegen hinter "Mehr". -->
{#snippet exerciseFields(d, id, result, actions)}
	{@const kind = kindOf(d)}
	{@const time = kind === 'time'}
	{@const max = time ? 3600 : 200}
	{@const open = d.more || !!result.more}
	<div class="flex gap-2">
		<div class="grid min-w-0 flex-1 gap-1">
			<Label for="{id}-kind" class="text-muted-foreground text-xs font-normal">Art</Label>
			<Select.Root type="single" bind:value={d.kind}>
				<Select.Trigger id="{id}-kind" class="h-11 w-full data-[size=default]:h-11">
					<span class="truncate">{kindLabel(kind)}</span>
				</Select.Trigger>
				<Select.Content>
					{#each KINDS as k (k.id)}
						<Select.Item value={k.id} label={k.label}>{k.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<div class="grid w-16 shrink-0 gap-1">
			<Label for="{id}-sets" class="text-muted-foreground text-xs font-normal">Sätze</Label>
			<Input
				id="{id}-sets"
				type="number"
				inputmode="numeric"
				min="1"
				max="20"
				bind:value={d.sets}
				class="h-11"
			/>
		</div>
	</div>
	<div class="grid gap-1">
		<Label for="{id}-reps" class="text-muted-foreground text-xs font-normal">
			{time ? 'Sekunden von / bis' : 'Wdh. von / bis'}
		</Label>
		<div class="flex items-center gap-1.5">
			<Input
				id="{id}-reps"
				type="number"
				inputmode="numeric"
				min="1"
				{max}
				bind:value={d.reps}
				class="h-11 w-18"
			/>
			<span class="text-muted-foreground text-sm">–</span>
			<Input
				type="number"
				inputmode="numeric"
				min="1"
				{max}
				bind:value={d.repsMax}
				placeholder="opt."
				aria-label={time ? 'Sekunden bis (optional, für einen Bereich)' : 'Wdh. bis (optional, für einen Bereich)'}
				class="h-11 w-18"
			/>
			<span class="flex-1"></span>
			{@render actions(result)}
		</div>
	</div>
	<Button
		type="button"
		variant="ghost"
		class="text-muted-foreground -ml-2 h-11 max-w-full justify-start self-start px-2 font-normal"
		aria-expanded={open}
		aria-controls="{id}-more"
		onclick={() => (d.more = !open)}
	>
		<ChevronDownIcon class="size-4 transition-transform {open ? 'rotate-180' : ''}" />
		<span class="truncate">Mehr: {moreSummary(d)}</span>
	</Button>
	{#if open}
		<div id="{id}-more" class="flex flex-col gap-1">
			<div class="flex gap-2">
				<div class="grid w-24 gap-1">
					<Label for="{id}-rest" class="text-muted-foreground text-xs font-normal">Pause (s)</Label>
					<Input
						id="{id}-rest"
						type="number"
						inputmode="numeric"
						min="0"
						max="900"
						bind:value={d.rest}
						class="h-11"
					/>
				</div>
				{#if kind === 'weight'}
					<div class="grid w-32 gap-1">
						<Label for="{id}-inc" class="text-muted-foreground text-xs font-normal">
							Steigerung (kg)
						</Label>
						<Input
							id="{id}-inc"
							type="text"
							inputmode="decimal"
							autocomplete="off"
							bind:value={d.increment}
							class="h-11"
						/>
					</div>
				{/if}
			</div>
			<p class="text-muted-foreground text-xs">
				{kind === 'weight'
					? '0 = kein Pausen-Timer bzw. kein Steigerungsvorschlag.'
					: '0 = kein Pausen-Timer.'}
			</p>
		</div>
	{/if}
	{#if result.error}
		<p class="text-destructive text-sm" role="alert">{result.error}</p>
	{/if}
{/snippet}

{#snippet addActions(result)}
	<Button
		type="submit"
		size="icon-lg"
		class="size-11 shrink-0"
		aria-label="Übung zu {workout.name} hinzufügen"
		disabled={adding || !newName.trim() || !result.fields}
	>
		<PlusIcon class="size-4" />
	</Button>
{/snippet}

{#snippet editActions(result)}
	<Button
		type="submit"
		variant="ghost"
		size="icon"
		class="size-11 shrink-0"
		aria-label="Übung speichern"
		disabled={!editName.trim() || !result.fields}
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
{/snippet}
