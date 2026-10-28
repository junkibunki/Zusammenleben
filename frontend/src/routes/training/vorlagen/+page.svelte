<script>
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import { auth } from '$lib/pocketbase.svelte.js';
	import {
		syncTraining,
		loadSharedWorkouts,
		copyWorkout,
		trainingError,
		kindOf,
		targetLabel,
		KINDS
	} from '$lib/training.svelte.js';
	import { personLabel } from '$lib/training-feed.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';

	// Freigegebene Trainings der anderen (Migration 1790686800), jedes mit
	// seinen Uebungen und einem Knopf, der es in den eigenen Plan kopiert.
	// Erreichbar aus den Trainings-Einstellungen.

	const userId = $derived(auth.user?.id ?? '');

	// Der eigene Plan muss geladen sein, damit die Kopie dort ankommt, wo die
	// Einstellungen sie danach zeigen.
	$effect(() => {
		if (userId) return syncTraining(userId);
	});

	let shared = $state([]);
	let loading = $state(true);
	let loadError = $state(null);

	$effect(() => {
		if (!userId) return;
		let cancelled = false;
		loadSharedWorkouts()
			.then((list) => {
				if (cancelled) return;
				shared = list.sort(
					(a, b) =>
						personLabel(a.expand?.user).localeCompare(personLabel(b.expand?.user), 'de') ||
						(a.sort ?? 0) - (b.sort ?? 0) ||
						String(a.created).localeCompare(String(b.created))
				);
				loading = false;
			})
			.catch((err) => {
				if (cancelled) return;
				loadError = trainingError(err, 'Trainings konnten nicht geladen werden.');
				loading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	const kindLabel = (kind) => KINDS.find((k) => k.id === kind)?.label ?? kind;

	// Pro Training: wird gerade kopiert, kopiert als <Name> oder Fehler.
	let busyId = $state('');
	let copied = $state({});
	let errors = $state({});

	async function copy(workout) {
		busyId = workout.id;
		errors[workout.id] = null;
		try {
			const record = await copyWorkout(workout.id);
			copied[workout.id] = record.name;
		} catch (err) {
			errors[workout.id] = trainingError(err, 'Kopieren fehlgeschlagen');
		} finally {
			busyId = '';
		}
	}
</script>

<main class="flex flex-1 flex-col gap-4 px-3 py-4">
	<div>
		<Button
			variant="ghost"
			size="lg"
			class="text-muted-foreground -ml-2 h-11"
			href="/training/einstellungen"
		>
			<ArrowLeftIcon class="size-4" />
			Zu den Einstellungen
		</Button>
	</div>

	<p class="text-muted-foreground text-sm">
		Diese Trainings haben andere freigegeben. Eine Kopie landet in deinem Plan und gehört dann dir
		– Änderungen daran bleiben bei dir.
	</p>

	{#if loadError}
		<Alert.Root variant="destructive">
			<AlertCircleIcon />
			<Alert.Description>{loadError}</Alert.Description>
		</Alert.Root>
	{/if}

	{#if loading}
		<p class="text-muted-foreground text-sm">Lade …</p>
	{:else if !loadError && shared.length === 0}
		<p class="text-muted-foreground text-sm">Noch hat niemand ein Training freigegeben.</p>
	{:else}
		{#each shared as workout (workout.id)}
			<Card.Root>
				<Card.Header>
					<Card.Title>{workout.name}</Card.Title>
					<Card.Description>
						von {personLabel(workout.expand?.user)} ·
						{workout.exercises.length === 1 ? '1 Übung' : `${workout.exercises.length} Übungen`}
					</Card.Description>
				</Card.Header>

				<Card.Content class="flex flex-col gap-4">
					{#if workout.exercises.length > 0}
						<ul class="divide-y overflow-hidden rounded-lg border">
							{#each workout.exercises as ex (ex.id)}
								<li class="px-3 py-2">
									<p class="truncate text-sm">{ex.name}</p>
									<p class="text-muted-foreground text-xs">
										{targetLabel(ex)}{kindOf(ex) !== 'weight' ? ` · ${kindLabel(kindOf(ex))}` : ''}
									</p>
								</li>
							{/each}
						</ul>
					{/if}

					{#if errors[workout.id]}
						<Alert.Root variant="destructive">
							<AlertCircleIcon />
							<Alert.Description>{errors[workout.id]}</Alert.Description>
						</Alert.Root>
					{/if}
					{#if copied[workout.id]}
						<Alert.Root>
							<CheckIcon />
							<Alert.Description>
								<span>
									Als „{copied[workout.id]}“ in deinen
									<a href="/training/einstellungen" class="underline underline-offset-4">Plan</a>
									übernommen.
								</span>
							</Alert.Description>
						</Alert.Root>
					{/if}
				</Card.Content>

				<Card.Footer>
					<Button
						size="lg"
						class="h-11 w-full"
						variant={copied[workout.id] ? 'outline' : 'default'}
						disabled={busyId !== ''}
						onclick={() => copy(workout)}
					>
						<CopyIcon class="size-4" />
						{busyId === workout.id
							? 'Kopiere …'
							: copied[workout.id]
								? 'Noch einmal kopieren'
								: 'In meinen Plan kopieren'}
					</Button>
				</Card.Footer>
			</Card.Root>
		{/each}
	{/if}
</main>
