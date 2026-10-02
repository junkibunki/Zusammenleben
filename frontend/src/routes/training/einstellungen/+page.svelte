<script>
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import BellIcon from '@lucide/svelte/icons/bell';
	import CheckIcon from '@lucide/svelte/icons/check';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { auth } from '$lib/pocketbase.svelte.js';
	import { push, refreshPush, enablePush } from '$lib/push.svelte.js';
	import {
		training,
		syncTraining,
		orderedWorkouts,
		addWorkout,
		savePlan,
		trainingError,
		WEEKDAYS,
		DEFAULT_REMIND_AT,
		WORKOUT_MAX
	} from '$lib/training.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import WorkoutCard from './WorkoutCard.svelte';

	// Einstellungen des eigenen Trainings: die Trainings (Push, Pull, …) mit
	// ihren Uebungen und die Trainingstage samt Erinnerung.

	const userId = $derived(auth.user?.id ?? '');

	$effect(() => {
		if (userId) return syncTraining(userId);
	});

	// Liest bewusst nichts aus `push` (siehe push.svelte.js).
	$effect(() => {
		refreshPush();
	});

	const workouts = $derived(orderedWorkouts());

	// --- Neues Training -----------------------------------------------------

	let workoutDraft = $state('');
	let adding = $state(false);
	let addError = $state(null);

	async function add(e) {
		e.preventDefault();
		if (!workoutDraft.trim()) return;
		adding = true;
		addError = null;
		try {
			await addWorkout(workoutDraft);
			workoutDraft = '';
		} catch (err) {
			addError = trainingError(err, 'Anlegen fehlgeschlagen');
		} finally {
			adding = false;
		}
	}

	// --- Trainingstage ------------------------------------------------------

	// Als String, damit der Effekt nur bei echter Aenderung feuert.
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
</script>

<main class="flex flex-1 flex-col gap-4 px-3 py-4">
	<div>
		<Button variant="ghost" size="lg" class="text-muted-foreground -ml-2 h-11" href="/training">
			<ArrowLeftIcon class="size-4" />
			Zum Training
		</Button>
	</div>

	{#if training.error}
		<Alert.Root variant="destructive">
			<AlertCircleIcon />
			<Alert.Description>{training.error}</Alert.Description>
		</Alert.Root>
	{/if}

	{#if training.loading}
		<p class="text-muted-foreground text-sm">Lade …</p>
	{:else}
		{#each workouts as workout, i (workout.id)}
			<WorkoutCard {workout} index={i} count={workouts.length} />
		{/each}

		<Card.Root>
			<Card.Header>
				<Card.Title>Neues Training</Card.Title>
				<Card.Description>
					Zum Beispiel Push, Pull und Beine. Beim Eintragen ist das nächste in dieser
					Reihenfolge vorausgewählt.
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<form class="flex items-center gap-2" onsubmit={add}>
					<Input
						type="text"
						bind:value={workoutDraft}
						maxlength={WORKOUT_MAX}
						placeholder="Name des Trainings"
						aria-label="Name des neuen Trainings"
						autocomplete="off"
						enterkeyhint="done"
						class="h-11 flex-1"
					/>
					<Button
						type="submit"
						size="lg"
						class="h-11 shrink-0"
						disabled={adding || !workoutDraft.trim()}
					>
						<PlusIcon class="size-4" />
						Anlegen
					</Button>
				</form>
				{#if addError}
					<Alert.Root variant="destructive">
						<AlertCircleIcon />
						<Alert.Description>{addError}</Alert.Description>
					</Alert.Root>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

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

				{#if daysDraft.length > 0 && !auth.user?.show_training}
					<Alert.Root>
						<BellIcon />
						<Alert.Description>
							<span>
								Erinnerungen kommen nur, wenn „Training anzeigen“ im
								<a href="/profile" class="underline underline-offset-4">Profil</a> eingeschaltet ist.
							</span>
						</Alert.Description>
					</Alert.Root>
				{/if}
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
</main>
