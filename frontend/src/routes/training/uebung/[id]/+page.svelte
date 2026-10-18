<script>
	import { page } from '$app/state';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import { auth } from '$lib/pocketbase.svelte.js';
	import {
		training,
		syncTraining,
		loadExerciseLogs,
		workingSets,
		formatSets,
		estimate1RM,
		volumeOf,
		targetLabel,
		kindOf,
		formatDate,
		formatWeight,
		trainingError
	} from '$lib/training.svelte.js';
	import TrainingChart from '$lib/TrainingChart.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';

	// Verlauf einer Uebung: Diagramm einer Kennzahl, Bestwerte, alle Eintraege.

	const userId = $derived(auth.user?.id ?? '');
	const exerciseId = $derived(page.params.id ?? '');

	$effect(() => {
		if (userId) return syncTraining(userId);
	});

	// Der ganze Verlauf kommt eigens, ohne die 1000er-Grenze von syncTraining.
	// Der Effekt liest nur userId/exerciseId und schreibt nur die drei Felder.
	let logs = $state([]);
	let logsLoading = $state(true);
	let logsError = $state(null);

	$effect(() => {
		const id = exerciseId;
		if (!userId || !id) return;
		let cancelled = false;
		logsLoading = true;
		logsError = null;
		loadExerciseLogs(id)
			.then((records) => {
				if (cancelled) return;
				logs = records;
				logsLoading = false;
			})
			.catch((err) => {
				if (cancelled) return;
				logsError = trainingError(err, 'Verlauf konnte nicht geladen werden.');
				logsLoading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	const exercise = $derived(training.exercises.find((e) => e.id === exerciseId));
	const workout = $derived(training.workouts.find((w) => w.id === exercise?.workout));
	const kind = $derived(kindOf(exercise));

	/** Summe der Wdh. der Arbeitssaetze (Koerpergewicht). */
	function totalReps(log) {
		return workingSets(log).reduce((sum, s) => sum + (s.reps ?? 0), 0);
	}

	/** Laengster Arbeitssatz in Sekunden (Zeit). */
	function longestSet(log) {
		return Math.max(0, ...workingSets(log).map((s) => s.seconds ?? 0));
	}

	const n = (v, digits = 1) => Number(v).toLocaleString('de-DE', { maximumFractionDigits: digits });

	// Kennzahlen je Art; `value` liefert 0 fuer "nicht verwertbar" (z.B. alte
	// Eintraege ohne Wdh.), solche Punkte fallen aus dem Diagramm.
	const METRICS = {
		weight: [
			{ id: 'weight', label: 'Gewicht', unit: 'kg', value: (l) => l.weight ?? 0, format: formatWeight },
			{ id: '1rm', label: 'Geschätztes 1RM', short: '1RM', unit: 'kg', value: estimate1RM, format: formatWeight },
			{ id: 'volume', label: 'Volumen', unit: 'kg', value: volumeOf, format: (v) => `${n(v, 0)} kg` }
		],
		bodyweight: [
			{ id: 'reps', label: 'Wdh. gesamt', unit: 'Wdh.', value: totalReps, format: (v) => `${n(v, 0)} Wdh.` }
		],
		time: [
			{ id: 'longest', label: 'Längster Satz', unit: 's', value: longestSet, format: (v) => `${n(v, 0)} s` }
		]
	};

	let metricId = $state('weight');
	const metrics = $derived(METRICS[kind] ?? METRICS.weight);
	const metric = $derived(metrics.find((m) => m.id === metricId) ?? metrics[0]);

	const points = $derived(
		logs
			.map((l) => ({ date: l.date, value: metric.value(l) }))
			.filter((p) => p.value > 0)
	);

	/** Der Eintrag mit dem hoechsten Wert von `fn` (der fruehere bei Gleichstand). */
	function bestBy(fn) {
		let best = null;
		let bestValue = 0;
		for (const l of logs) {
			const v = fn(l);
			if (v > bestValue) {
				best = l;
				bestValue = v;
			}
		}
		return best ? { value: bestValue, date: best.date } : null;
	}

	const bests = $derived.by(() => {
		const list = [];
		if (kind === 'weight') {
			list.push({ label: 'Schwerstes Gewicht', best: bestBy((l) => l.weight ?? 0), format: formatWeight });
			list.push({ label: 'Bestes 1RM (geschätzt)', best: bestBy(estimate1RM), format: formatWeight });
			list.push({ label: 'Höchstes Volumen', best: bestBy(volumeOf), format: METRICS.weight[2].format });
		} else if (kind === 'bodyweight') {
			list.push({ label: 'Meiste Wdh. gesamt', best: bestBy(totalReps), format: METRICS.bodyweight[0].format });
			const extra = bestBy((l) => l.weight ?? 0);
			if (extra) list.push({ label: 'Meistes Zusatzgewicht', best: extra, format: formatWeight });
		} else {
			list.push({ label: 'Längster Satz', best: bestBy(longestSet), format: METRICS.time[0].format });
		}
		return list;
	});

	const newestFirst = $derived([...logs].reverse());

	const thisYear = new Date().getFullYear();
	/** "Fr, 02.10." -- mit Jahr, wenn es nicht das laufende ist. */
	function dateLabel(date) {
		const year = Number(String(date).slice(0, 4));
		return year === thisYear ? formatDate(date) : `${formatDate(date)}${year}`;
	}
</script>

<main class="flex flex-1 flex-col gap-4 px-3 py-4">
	<div>
		<Button href="/training" variant="ghost" class="text-muted-foreground -ml-2 h-11">
			<ArrowLeftIcon class="size-4" />
			Zurück zum Training
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
	{:else if !exercise}
		{#if !training.error}
			<Card.Root>
				<Card.Header>
					<Card.Title>Übung nicht gefunden</Card.Title>
					<Card.Description>
						Diese Übung gibt es nicht (mehr). Vielleicht wurde sie in den Einstellungen gelöscht.
					</Card.Description>
				</Card.Header>
				<Card.Footer>
					<Button href="/training" variant="outline" size="lg" class="h-11 w-full">
						Zum Training
					</Button>
				</Card.Footer>
			</Card.Root>
		{/if}
	{:else}
		<Card.Root>
			<Card.Header>
				<Card.Title>{exercise.name}</Card.Title>
				<Card.Description>
					{#if workout}{workout.name} · {/if}{targetLabel(exercise)}
				</Card.Description>
			</Card.Header>

			<Card.Content class="flex flex-col gap-4">
				{#if metrics.length > 1}
					<div role="group" aria-label="Kennzahl" class="bg-muted grid grid-cols-3 gap-1 rounded-lg p-1">
						{#each metrics as m (m.id)}
							{@const on = m.id === metric.id}
							<button
								type="button"
								aria-pressed={on}
								onclick={() => (metricId = m.id)}
								class="flex h-11 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors {on
									? 'bg-background text-foreground shadow-sm'
									: 'text-muted-foreground hover:text-foreground'}"
							>
								{m.short ?? m.label}
							</button>
						{/each}
					</div>
				{:else}
					<p class="text-muted-foreground text-sm">{metric.label}</p>
				{/if}

				{#if logsError}
					<Alert.Root variant="destructive">
						<AlertCircleIcon />
						<Alert.Description>{logsError}</Alert.Description>
					</Alert.Root>
				{:else if logsLoading}
					<p class="text-muted-foreground text-sm">Lade Verlauf …</p>
				{:else if logs.length === 0}
					<p class="text-muted-foreground text-sm">
						Für diese Übung ist noch nichts eingetragen.
					</p>
				{:else}
					<TrainingChart
						{points}
						unit={metric.unit}
						label={metric.label}
						format={metric.format}
					/>
				{/if}
			</Card.Content>
		</Card.Root>

		{#if !logsLoading && !logsError && logs.length > 0}
			<Card.Root>
				<Card.Header>
					<Card.Title>Bestwerte</Card.Title>
				</Card.Header>
				<Card.Content>
					<dl class="grid grid-cols-2 gap-3">
						{#each bests as b (b.label)}
							<div class="bg-muted/50 rounded-lg p-3">
								<dt class="text-muted-foreground text-xs">{b.label}</dt>
								<dd class="mt-1">
									{#if b.best}
										<span class="block text-lg font-semibold tabular-nums">
											{b.format(b.best.value)}
										</span>
										<span class="text-muted-foreground text-xs">{dateLabel(b.best.date)}</span>
									{:else}
										<span class="text-muted-foreground block text-lg">–</span>
									{/if}
								</dd>
							</div>
						{/each}
						<div class="bg-muted/50 rounded-lg p-3">
							<dt class="text-muted-foreground text-xs">Trainings</dt>
							<dd class="mt-1 text-lg font-semibold tabular-nums">{logs.length}</dd>
						</div>
					</dl>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header>
					<Card.Title>Alle Einträge</Card.Title>
				</Card.Header>
				<Card.Content>
					<ul class="divide-y overflow-hidden rounded-lg border">
						{#each newestFirst as log (log.id)}
							{@const sets = formatSets(exercise, log)}
							<li class="flex flex-col gap-0.5 px-3 py-2">
								<div class="flex items-baseline justify-between gap-3">
									<span class="text-sm font-medium">{dateLabel(log.date)}</span>
									<span class="text-sm tabular-nums">{sets || '–'}</span>
								</div>
								{#if log.note}
									<p class="text-muted-foreground text-sm break-words whitespace-pre-line">
										{log.note}
									</p>
								{/if}
							</li>
						{/each}
					</ul>
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}
</main>
