<script>
	import { untrack } from 'svelte';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import BellIcon from '@lucide/svelte/icons/bell';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import { auth } from '$lib/pocketbase.svelte.js';
	import { push, refreshPush, enablePush } from '$lib/push.svelte.js';
	import {
		training,
		syncTraining,
		orderedExercises,
		savePlan,
		addExercise,
		updateExercise,
		deleteExercise,
		moveExercise,
		saveDay,
		logFor,
		previousLog,
		today,
		formatDate,
		formatWeight,
		parseWeight,
		trainingError,
		WEEKDAYS,
		DEFAULT_REMIND_AT,
		EXERCISE_MAX
	} from '$lib/training.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';

	const userId = $derived(auth.user?.id ?? '');

	$effect(() => {
		if (userId) return syncTraining(userId);
	});

	// Liest bewusst nichts aus `push` (siehe push.svelte.js).
	$effect(() => {
		refreshPush();
	});

	const exercises = $derived(orderedExercises());
	const byId = $derived(Object.fromEntries(training.exercises.map((e) => [e.id, e])));

	// --- Training eintragen -------------------------------------------------

	let date = $state(today());
	let weightDrafts = $state({});
	let dayBusy = $state(false);
	let dayError = $state(null);
	let daySaved = $state(false);

	// Als String, damit der Effekt nur bei echter Aenderung feuert: Eingaben
	// sollen nicht von einem gleichen Stand ueberschrieben werden.
	const savedWeights = $derived(
		JSON.stringify(
			Object.fromEntries(
				training.exercises.map((e) => {
					const log = logFor(e.id, date);
					return [e.id, log ? String(log.weight).replace('.', ',') : ''];
				})
			)
		)
	);

	// Nur die Felder neu setzen, deren gespeicherter Wert sich geaendert hat --
	// sonst loeschte ein teilweise gescheitertes Speichern oder eine neue Uebung
	// alle noch nicht gespeicherten Eingaben. Beim Datumswechsel aendern sich
	// ohnehin alle. `previous` ist bewusst kein $state.
	let previous = {};
	$effect(() => {
		const next = JSON.parse(savedWeights);
		const drafts = untrack(() => weightDrafts);
		const merged = {};
		for (const [id, value] of Object.entries(next)) {
			merged[id] = previous[id] === value && id in drafts ? drafts[id] : value;
		}
		previous = next;
		weightDrafts = merged;
	});

	const parsed = $derived(
		Object.fromEntries(exercises.map((e) => [e.id, parseWeight(weightDrafts[e.id])]))
	);
	const invalid = $derived(Object.values(parsed).some((kg) => Number.isNaN(kg)));
	const dayDirty = $derived(
		exercises.some((e) => (weightDrafts[e.id] ?? '') !== (JSON.parse(savedWeights)[e.id] ?? ''))
	);

	async function submitDay(e) {
		e.preventDefault();
		if (invalid || !dayDirty || !date) return;
		dayBusy = true;
		dayError = null;
		daySaved = false;
		try {
			await saveDay(date, parsed);
			daySaved = true;
		} catch (err) {
			dayError = trainingError(err, 'Speichern fehlgeschlagen');
		} finally {
			dayBusy = false;
		}
	}

	// --- Uebungen -----------------------------------------------------------

	let newName = $state('');
	let newSets = $state(3);
	let newReps = $state(10);
	let adding = $state(false);
	let exError = $state(null);

	let editingId = $state('');
	let editName = $state('');
	let editSets = $state(3);
	let editReps = $state(10);
	let moving = $state(false);

	let confirmOpen = $state(false);
	let pending = $state(null);

	const validCount = (n, max) => Number.isInteger(n) && n >= 1 && n <= max;

	async function add(e) {
		e.preventDefault();
		if (!newName.trim() || !validCount(newSets, 20) || !validCount(newReps, 200)) return;
		adding = true;
		exError = null;
		try {
			await addExercise({ name: newName, sets: newSets, reps: newReps });
			newName = '';
		} catch (err) {
			exError = trainingError(err, 'Anlegen fehlgeschlagen');
		} finally {
			adding = false;
		}
	}

	function startEdit(ex) {
		editingId = ex.id;
		editName = ex.name;
		editSets = ex.sets;
		editReps = ex.reps;
		exError = null;
	}

	async function saveEdit(e, ex) {
		e.preventDefault();
		if (!editName.trim() || !validCount(editSets, 20) || !validCount(editReps, 200)) return;
		try {
			await updateExercise(ex, { name: editName, sets: editSets, reps: editReps });
			editingId = '';
			exError = null;
		} catch (err) {
			exError = trainingError(err, 'Speichern fehlgeschlagen');
		}
	}

	async function move(ex, delta) {
		moving = true;
		exError = null;
		try {
			await moveExercise(ex, delta);
		} catch (err) {
			exError = trainingError(err, 'Verschieben fehlgeschlagen');
		} finally {
			moving = false;
		}
	}

	function askDelete(ex) {
		pending = ex;
		confirmOpen = true;
	}

	async function confirmDelete() {
		// Selbst schliessen: `AlertDialog.Action` schliesst mit eigenem onclick
		// nicht von allein (docs/pitfalls/designsystem.md).
		confirmOpen = false;
		const ex = pending;
		if (!ex) return;
		exError = null;
		try {
			await deleteExercise(ex);
		} catch (err) {
			exError = trainingError(err, 'Löschen fehlgeschlagen');
		}
	}

	// --- Trainingstage ------------------------------------------------------

	const savedDays = $derived(JSON.stringify(training.plan?.days ?? []));
	const savedTime = $derived(training.plan?.remind_at || DEFAULT_REMIND_AT);
	let daysDraft = $state([]);
	let timeDraft = $state(DEFAULT_REMIND_AT);
	let planBusy = $state(false);
	let planError = $state(null);
	let planSaved = $state(false);

	$effect(() => {
		daysDraft = JSON.parse(savedDays);
	});
	$effect(() => {
		timeDraft = savedTime;
	});

	// Wochentage immer in Anzeigereihenfolge -- die Reihenfolge des Antippens
	// soll keinen Unterschied machen.
	const inOrder = (days) => WEEKDAYS.map((d) => d.id).filter((id) => days.includes(id));
	const planDirty = $derived(
		inOrder(daysDraft).join() !== inOrder(JSON.parse(savedDays)).join() ||
			(timeDraft || '') !== savedTime
	);

	function toggleDay(id) {
		planSaved = false;
		daysDraft = daysDraft.includes(id) ? daysDraft.filter((d) => d !== id) : [...daysDraft, id];
	}

	async function submitPlan(e) {
		e.preventDefault();
		if (!planDirty || !timeDraft) return;
		planBusy = true;
		planError = null;
		planSaved = false;
		try {
			await savePlan(inOrder(daysDraft), timeDraft);
			planSaved = true;
		} catch (err) {
			planError = trainingError(err, 'Speichern fehlgeschlagen');
		} finally {
			planBusy = false;
		}
	}

	// --- Verlauf ------------------------------------------------------------

	const HISTORY_DAYS = 10;
	let showAll = $state(false);

	const history = $derived.by(() => {
		const groups = new Map();
		for (const log of training.logs) {
			if (!byId[log.exercise]) continue;
			if (!groups.has(log.date)) groups.set(log.date, []);
			groups.get(log.date).push(log);
		}
		const order = Object.fromEntries(exercises.map((e, i) => [e.id, i]));
		return [...groups.entries()]
			.sort(([a], [b]) => b.localeCompare(a))
			.map(([day, logs]) => ({
				day,
				logs: logs.sort((a, b) => (order[a.exercise] ?? 0) - (order[b.exercise] ?? 0))
			}));
	});
	const shownHistory = $derived(showAll ? history : history.slice(0, HISTORY_DAYS));
</script>

<main class="flex flex-1 flex-col gap-4 px-3 py-4">
	{#if training.error}
		<Alert.Root variant="destructive">
			<AlertCircleIcon />
			<Alert.Description>{training.error}</Alert.Description>
		</Alert.Root>
	{/if}

	<Card.Root>
		<form class="flex flex-col gap-(--card-spacing)" onsubmit={submitDay}>
			<Card.Header>
				<Card.Title>Training eintragen</Card.Title>
				<Card.Description>Welches Gewicht du pro Übung geschafft hast.</Card.Description>
			</Card.Header>

			<Card.Content class="flex flex-col gap-4">
				<div class="grid gap-2">
					<Label for="training-date">Datum</Label>
					<Input
						id="training-date"
						type="date"
						bind:value={date}
						max={today()}
						oninput={() => (daySaved = false)}
						class="h-11"
					/>
				</div>

				{#if training.loading}
					<p class="text-muted-foreground text-sm">Lade …</p>
				{:else if exercises.length === 0}
					<p class="text-muted-foreground text-sm">
						Noch keine Übungen – lege unten deinen Plan an.
					</p>
				{:else}
					<ul class="divide-y overflow-hidden rounded-lg border">
						{#each exercises as ex (ex.id)}
							{@const prev = previousLog(ex.id, date)}
							{@const bad = Number.isNaN(parsed[ex.id])}
							<li class="flex items-center gap-3 px-3 py-2">
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium">{ex.name}</p>
									<p class="text-muted-foreground text-xs">
										{ex.sets} × {ex.reps}
										{#if prev}
											· zuletzt {formatWeight(prev.weight)} ({formatDate(prev.date)})
										{/if}
									</p>
								</div>
								<div class="flex shrink-0 items-center gap-1.5">
									<Input
										type="text"
										inputmode="decimal"
										bind:value={weightDrafts[ex.id]}
										oninput={() => (daySaved = false)}
										placeholder={prev ? String(prev.weight).replace('.', ',') : '0'}
										aria-label="Gewicht für {ex.name} in Kilogramm"
										aria-invalid={bad || undefined}
										autocomplete="off"
										class="h-11 w-20 text-right"
									/>
									<span class="text-muted-foreground text-sm">kg</span>
								</div>
							</li>
						{/each}
					</ul>

					{#if invalid}
						<Alert.Root variant="destructive">
							<AlertCircleIcon />
							<Alert.Description>
								Bitte nur Zahlen bis 1000 eingeben, z.&nbsp;B. 42,5.
							</Alert.Description>
						</Alert.Root>
					{/if}
				{/if}

				{#if dayError}
					<Alert.Root variant="destructive">
						<AlertCircleIcon />
						<Alert.Description>{dayError}</Alert.Description>
					</Alert.Root>
				{/if}
				{#if daySaved}
					<Alert.Root>
						<CheckIcon />
						<Alert.Description>Gespeichert.</Alert.Description>
					</Alert.Root>
				{/if}
			</Card.Content>

			{#if exercises.length > 0}
				<Card.Footer>
					<Button
						type="submit"
						size="lg"
						class="h-11 w-full"
						disabled={dayBusy || invalid || !dayDirty || !date}
					>
						{dayBusy ? 'Speichern …' : 'Training speichern'}
					</Button>
				</Card.Footer>
			{/if}
		</form>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Übungen</Card.Title>
			<Card.Description>Dein Plan: welche Übung, wie viele Sätze, wie viele Wiederholungen.</Card.Description>
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
									onclick={() => askDelete(ex)}
								>
									<Trash2Icon class="size-4" />
								</Button>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if exError}
				<Alert.Root variant="destructive">
					<AlertCircleIcon />
					<Alert.Description>{exError}</Alert.Description>
				</Alert.Root>
			{/if}

			<form class="flex flex-col gap-2" onsubmit={add}>
				<Input
					type="text"
					bind:value={newName}
					maxlength={EXERCISE_MAX}
					placeholder="Neue Übung, z. B. Bankdrücken"
					aria-label="Neue Übung"
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
						aria-label="Übung hinzufügen"
						disabled={adding || !newName.trim() || !validCount(newSets, 20) || !validCount(newReps, 200)}
					>
						<PlusIcon class="size-4" />
					</Button>
				</div>
			</form>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<form class="flex flex-col gap-(--card-spacing)" onsubmit={submitPlan}>
			<Card.Header>
				<Card.Title>Trainingstage</Card.Title>
				<Card.Description>An diesen Tagen erinnert dich eine Benachrichtigung.</Card.Description>
			</Card.Header>

			<Card.Content class="flex flex-col gap-4">
				<div class="grid grid-cols-7 gap-1" role="group" aria-label="Trainingstage">
					{#each WEEKDAYS as day (day.id)}
						{@const on = daysDraft.includes(day.id)}
						<Button
							type="button"
							variant={on ? 'default' : 'outline'}
							class="h-11 min-w-0 px-0"
							aria-pressed={on}
							aria-label={day.long}
							onclick={() => toggleDay(day.id)}
						>
							{day.short}
						</Button>
					{/each}
				</div>

				<div class="grid gap-2">
					<Label for="remind-at">Uhrzeit der Erinnerung</Label>
					<Input
						id="remind-at"
						type="time"
						bind:value={timeDraft}
						oninput={() => (planSaved = false)}
						required
						class="h-11"
					/>
				</div>

				{#if daysDraft.length > 0 && !push.enabled}
					<Alert.Root>
						<BellIcon />
						<Alert.Description class="flex flex-col gap-2">
							{#if !push.supported}
								Dieses Gerät kann keine Benachrichtigungen empfangen. Auf dem iPhone geht das nur in
								der installierten App.
							{:else if push.permission === 'denied'}
								Benachrichtigungen sind für diese Seite blockiert. Das lässt sich nur in den
								Einstellungen des Browsers wieder erlauben.
							{:else}
								<span>Auf diesem Gerät sind Benachrichtigungen aus.</span>
								<Button
									type="button"
									variant="outline"
									size="lg"
									class="h-11"
									disabled={push.busy}
									onclick={enablePush}
								>
									Benachrichtigungen einschalten
								</Button>
							{/if}
						</Alert.Description>
					</Alert.Root>
				{/if}
				{#if push.error}
					<Alert.Root variant="destructive">
						<AlertCircleIcon />
						<Alert.Description>{push.error}</Alert.Description>
					</Alert.Root>
				{/if}

				{#if planError}
					<Alert.Root variant="destructive">
						<AlertCircleIcon />
						<Alert.Description>{planError}</Alert.Description>
					</Alert.Root>
				{/if}
				{#if planSaved}
					<Alert.Root>
						<CheckIcon />
						<Alert.Description>Gespeichert.</Alert.Description>
					</Alert.Root>
				{/if}
			</Card.Content>

			<Card.Footer>
				<Button
					type="submit"
					size="lg"
					class="h-11 w-full"
					disabled={planBusy || !planDirty || !timeDraft || training.loading}
				>
					{planBusy ? 'Speichern …' : 'Speichern'}
				</Button>
			</Card.Footer>
		</form>
	</Card.Root>

	{#if history.length > 0}
		<Card.Root>
			<Card.Header>
				<Card.Title>Verlauf</Card.Title>
			</Card.Header>
			<Card.Content class="flex flex-col gap-3">
				{#each shownHistory as group (group.day)}
					<div>
						<h3 class="text-sm font-medium">{formatDate(group.day)}</h3>
						<ul class="text-muted-foreground mt-1 flex flex-col gap-0.5 text-sm">
							{#each group.logs as log (log.id)}
								<li class="flex justify-between gap-3">
									<span class="truncate">{byId[log.exercise]?.name}</span>
									<span class="text-foreground shrink-0 tabular-nums">{formatWeight(log.weight)}</span>
								</li>
							{/each}
						</ul>
					</div>
				{/each}
				{#if history.length > HISTORY_DAYS}
					<Button variant="ghost" size="lg" class="h-11" onclick={() => (showAll = !showAll)}>
						{showAll ? 'Weniger anzeigen' : `Alle ${history.length} Trainings anzeigen`}
					</Button>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</main>

<AlertDialog.Root bind:open={confirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Übung „{pending?.name}“ löschen?</AlertDialog.Title>
			<AlertDialog.Description>
				Alle eingetragenen Gewichte dieser Übung gehen dabei verloren.
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
