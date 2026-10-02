<script>
	import { untrack } from 'svelte';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import CheckIcon from '@lucide/svelte/icons/check';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import { auth } from '$lib/pocketbase.svelte.js';
	import {
		training,
		syncTraining,
		orderedWorkouts,
		exercisesOf,
		suggestedWorkout,
		saveDay,
		logFor,
		previousLog,
		today,
		formatDate,
		formatWeight,
		parseWeight,
		trainingError
	} from '$lib/training.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as Select from '$lib/components/ui/select/index.js';

	// Nur das Eintragen; Trainings, Uebungen und Trainingstage stehen unter
	// /training/einstellungen.

	const userId = $derived(auth.user?.id ?? '');

	$effect(() => {
		if (userId) return syncTraining(userId);
	});

	let date = $state(today());
	let weightDrafts = $state({});
	let busy = $state(false);
	let error = $state(null);
	let saved = $state(false);

	// Gewaehltes Training; leer heisst "Vorschlag" (suggestedWorkout). Ein
	// Datumswechsel setzt es zurueck, damit der Vorschlag fuer den neuen Tag gilt.
	let picked = $state('');
	const workouts = $derived(orderedWorkouts());
	const suggested = $derived(suggestedWorkout(date));
	const workout = $derived(workouts.find((w) => w.id === picked) ?? suggested);
	const exercises = $derived(workout ? exercisesOf(workout.id) : []);

	function pickDate() {
		picked = '';
		saved = false;
	}

	function pickWorkout(id) {
		picked = id;
		saved = false;
	}

	// Als String, damit der Effekt nur bei echter Aenderung feuert. Ueber *alle*
	// Uebungen, nicht nur die des gewaehlten Trainings: ein Wechsel des Trainings
	// soll Eingaben im anderen nicht verwerfen.
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
	// sonst loeschte ein teilweise gescheitertes Speichern alle noch nicht
	// gespeicherten Eingaben. `previous` ist bewusst kein $state.
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
	const dirty = $derived.by(() => {
		const stored = JSON.parse(savedWeights);
		return exercises.some((e) => (weightDrafts[e.id] ?? '') !== (stored[e.id] ?? ''));
	});

	async function submit(e) {
		e.preventDefault();
		if (invalid || !dirty || !date) return;
		busy = true;
		error = null;
		saved = false;
		try {
			await saveDay(date, parsed);
			saved = true;
		} catch (err) {
			error = trainingError(err, 'Speichern fehlgeschlagen');
		} finally {
			busy = false;
		}
	}
</script>

<main class="flex flex-1 flex-col gap-4 px-3 py-4">
	{#if training.error}
		<Alert.Root variant="destructive">
			<AlertCircleIcon />
			<Alert.Description>{training.error}</Alert.Description>
		</Alert.Root>
	{/if}

	<Card.Root>
		<form class="flex flex-col gap-(--card-spacing)" onsubmit={submit}>
			<Card.Header>
				<Card.Title>Training eintragen</Card.Title>
				<Card.Description>Welches Gewicht du pro Übung geschafft hast.</Card.Description>
				<Card.Action>
					<Button
						href="/training/einstellungen"
						variant="ghost"
						size="icon"
						class="text-muted-foreground -mt-2 -mr-2 size-11"
						aria-label="Training einrichten"
					>
						<SettingsIcon class="size-5" />
					</Button>
				</Card.Action>
			</Card.Header>

			<Card.Content class="flex flex-col gap-4">
				<div class="grid gap-2">
					<Label for="training-date">Datum</Label>
					<Input
						id="training-date"
						type="date"
						bind:value={date}
						max={today()}
						oninput={pickDate}
						class="h-11"
					/>
				</div>

				{#if training.loading}
					<p class="text-muted-foreground text-sm">Lade …</p>
				{:else if workouts.length === 0}
					<p class="text-muted-foreground text-sm">
						Noch kein Training angelegt. Lege über das Zahnrad deine Trainings und Übungen an.
					</p>
					<Button href="/training/einstellungen" variant="outline" size="lg" class="h-11">
						<SettingsIcon class="size-4" />
						Training einrichten
					</Button>
				{:else}
					<div class="grid gap-2">
						<Label for="training-workout">Training</Label>
						<!-- Kein bind:value: das Select laesst sich abwaehlen (""), angezeigt
						     und benutzt wird immer `workout` (docs/pitfalls/designsystem.md). -->
						<Select.Root
							type="single"
							value={workout?.id ?? ''}
							onValueChange={(v) => v && pickWorkout(v)}
						>
							<Select.Trigger
								id="training-workout"
								class="h-11 w-full data-[size=default]:h-11"
							>
								<span class="truncate">{workout?.name ?? ''}</span>
							</Select.Trigger>
							<Select.Content>
								{#each workouts as w (w.id)}
									<Select.Item value={w.id} label={w.name}>{w.name}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>

					{#if exercises.length === 0}
						<p class="text-muted-foreground text-sm">
							„{workout?.name}“ hat noch keine Übungen.
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
											oninput={() => (saved = false)}
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
					{/if}

					{#if invalid}
						<Alert.Root variant="destructive">
							<AlertCircleIcon />
							<Alert.Description>
								Bitte nur Zahlen bis 1000 eingeben, z.&nbsp;B. 42,5.
							</Alert.Description>
						</Alert.Root>
					{/if}
				{/if}

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

			{#if exercises.length > 0}
				<Card.Footer>
					<Button
						type="submit"
						size="lg"
						class="h-11 w-full"
						disabled={busy || invalid || !dirty || !date}
					>
						{busy ? 'Speichern …' : 'Training speichern'}
					</Button>
				</Card.Footer>
			{/if}
		</form>
	</Card.Root>
</main>
