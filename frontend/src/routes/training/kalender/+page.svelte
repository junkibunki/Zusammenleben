<script>
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import { auth } from '$lib/pocketbase.svelte.js';
	import {
		training,
		syncTraining,
		loadDays,
		hasSets,
		orderedWorkouts,
		formatDate,
		formatDuration,
		trainingError,
		today,
		WEEKDAYS
	} from '$lib/training.svelte.js';
	import TrainingTabs from '../TrainingTabs.svelte';
	import DayWeight from './DayWeight.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';

	// Monatsansicht: an welchen Tagen trainiert wurde (und welches Training),
	// welche Wochentage geplant sind, Trainings pro Woche.

	const userId = $derived(auth.user?.id ?? '');

	$effect(() => {
		if (userId) return syncTraining(userId);
	});

	const pad = (v) => String(v).padStart(2, '0');
	/** Date (lokal) -> "YYYY-MM-DD" */
	function iso(d) {
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	}
	/** "YYYY-MM-DD" -> Date (lokal, mittags -- Sommerzeit verschiebt so keinen Tag) */
	function parse(date) {
		const [y, m, d] = date.split('-').map(Number);
		return new Date(y, m - 1, d, 12);
	}
	function addDays(date, n) {
		const d = parse(date);
		d.setDate(d.getDate() + n);
		return iso(d);
	}
	/** Montag der Woche von `date` */
	function mondayOf(date) {
		const d = parse(date);
		return addDays(date, -((d.getDay() + 6) % 7));
	}
	/** Kalenderwoche nach ISO 8601 */
	function isoWeek(date) {
		const d = parse(date);
		d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
		const jan4 = new Date(d.getFullYear(), 0, 4, 12);
		return 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
	}
	/** Wochentag-ID ('mo'..'so') von `date` */
	function weekdayId(date) {
		return WEEKDAYS[(parse(date).getDay() + 6) % 7].id;
	}
	function shortDate(date) {
		const [, m, d] = date.split('-');
		return `${d}.${m}.`;
	}

	const todayIso = today();
	let month = $state(todayIso.slice(0, 7)); // "YYYY-MM"
	let selected = $state(todayIso);

	function shiftMonth(delta) {
		const [y, m] = month.split('-').map(Number);
		const d = new Date(y, m - 1 + delta, 1, 12);
		month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
		// Die Auswahl wandert mit, sonst zeigte unten ein Tag ausserhalb des
		// geladenen Bereichs "kein Training".
		selected = todayIso.startsWith(month) ? todayIso : `${month}-01`;
	}

	const monthLabel = $derived(
		parse(`${month}-01`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
	);

	// Das Raster beginnt am Montag vor dem 1. und endet am Sonntag nach dem
	// Letzten -- geladen wird genau dieser Bereich, damit auch die Randwochen
	// vollstaendig gezaehlt sind.
	const weeks = $derived.by(() => {
		const first = `${month}-01`;
		const [y, m] = month.split('-').map(Number);
		const lastDay = iso(new Date(y, m, 0, 12));
		const list = [];
		for (let start = mondayOf(first); start <= lastDay; start = addDays(start, 7)) {
			list.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
		}
		return list;
	});
	const from = $derived(weeks[0][0]);
	const to = $derived(weeks[weeks.length - 1][6]);

	// Liest nur userId/from/to, schreibt nur die drei Felder unten (CLAUDE.md:
	// keine $effect-Schleife). Die alten Daten bleiben stehen, bis die neuen da sind.
	let days = $state({ logs: [], sessions: [] });
	let daysLoading = $state(true);
	let daysError = $state(null);

	$effect(() => {
		const range = [from, to];
		if (!userId) return;
		let cancelled = false;
		daysLoading = true;
		daysError = null;
		loadDays(range[0], range[1])
			.then((result) => {
				if (cancelled) return;
				days = result;
				daysLoading = false;
			})
			.catch((err) => {
				if (cancelled) return;
				daysError = trainingError(err, 'Kalender konnte nicht geladen werden.');
				daysLoading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	const workouts = $derived(orderedWorkouts());
	const workoutById = $derived(Object.fromEntries(workouts.map((w) => [w.id, w])));
	const workoutOf = $derived(Object.fromEntries(training.exercises.map((e) => [e.id, e.workout])));
	// Farbe nach Platz in der Reihenfolge der Trainings; ab dem neunten grau.
	const slotOf = $derived(Object.fromEntries(workouts.map((w, i) => [w.id, i < 8 ? i + 1 : 0])));

	/**
	 * Pro Datum: Trainings (IDs, haeufigstes zuerst), Zahl der Uebungen, Session.
	 * `logs`/`sessions` aus loadDays oder dem Store.
	 */
	function summarize(logs, sessions) {
		const map = {};
		const entry = (date) => (map[date] ??= { counts: {}, exercises: 0, session: null });
		for (const l of logs) {
			// Ein Eintrag nur mit Notiz ist kein Trainingstag.
			if (!hasSets(l)) continue;
			const e = entry(l.date);
			e.exercises += 1;
			const w = workoutOf[l.exercise];
			if (w) e.counts[w] = (e.counts[w] ?? 0) + 1;
		}
		for (const s of sessions) {
			const e = entry(s.date);
			e.session = s;
			if (s.workout && !(s.workout in e.counts)) e.counts[s.workout] = 0;
		}
		for (const e of Object.values(map)) {
			const ids = Object.keys(e.counts).filter((id) => workoutById[id]);
			// Das Training der Session zaehlt vor, sonst das mit den meisten Uebungen.
			ids.sort(
				(a, b) =>
					(b === e.session?.workout) - (a === e.session?.workout) || e.counts[b] - e.counts[a]
			);
			e.workouts = ids;
		}
		return map;
	}

	const byDate = $derived(summarize(days.logs, days.sessions));
	const trained = (info) => Boolean(info && (info.exercises > 0 || info.session));

	const planDays = $derived(new Set(training.plan?.days ?? []));
	const planned = $derived(planDays.size);

	// Diese Woche aus dem Store (syncTraining laedt die juengsten Eintraege) --
	// unabhaengig davon, welcher Monat gerade angezeigt wird.
	const thisWeek = $derived.by(() => {
		const start = mondayOf(todayIso);
		const end = addDays(start, 6);
		const inWeek = (d) => d >= start && d <= end;
		const map = summarize(
			training.logs.filter((l) => inWeek(l.date)),
			training.sessions.filter((s) => inWeek(s.date))
		);
		return Object.values(map).filter(trained).length;
	});

	const weekRows = $derived(
		weeks.map((w) => ({
			start: w[0],
			end: w[6],
			kw: isoWeek(w[0]),
			count: w.filter((d) => trained(byDate[d])).length
		}))
	);

	const info = $derived(byDate[selected]);
	const selectedWorkouts = $derived((info?.workouts ?? []).map((id) => workoutById[id]));

	function select(date) {
		selected = date;
		if (date.slice(0, 7) !== month) month = date.slice(0, 7);
	}
</script>

<main class="flex flex-1 flex-col gap-4 px-3 py-4">
	<TrainingTabs />

	{#if training.error}
		<Alert.Root variant="destructive">
			<AlertCircleIcon />
			<Alert.Description>{training.error}</Alert.Description>
		</Alert.Root>
	{/if}
	{#if daysError}
		<Alert.Root variant="destructive">
			<AlertCircleIcon />
			<Alert.Description>{daysError}</Alert.Description>
		</Alert.Root>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title>Kalender</Card.Title>
			<Card.Description>
				{#if training.loading}
					Lade …
				{:else if planned > 0}
					Diese Woche: {thisWeek} von {planned} geplanten Trainings
				{:else}
					Diese Woche: {thisWeek}
					{thisWeek === 1 ? 'Training' : 'Trainings'} (keine Trainingstage geplant)
				{/if}
			</Card.Description>
		</Card.Header>

		<Card.Content class="flex flex-col gap-3">
			<div class="flex items-center gap-1">
				<Button
					variant="ghost"
					size="icon"
					class="size-11"
					aria-label="Voriger Monat"
					onclick={() => shiftMonth(-1)}
				>
					<ChevronLeftIcon class="size-5" />
				</Button>
				<h2 class="flex-1 text-center text-base font-semibold" aria-live="polite">{monthLabel}</h2>
				<Button
					variant="ghost"
					size="icon"
					class="size-11"
					aria-label="Nächster Monat"
					onclick={() => shiftMonth(1)}
				>
					<ChevronRightIcon class="size-5" />
				</Button>
			</div>

			<div
				class="grid grid-cols-7 gap-1 transition-opacity {daysLoading ? 'opacity-60' : ''}"
				aria-busy={daysLoading}
			>
				{#each WEEKDAYS as wd (wd.id)}
					<div
						class="flex h-6 items-center justify-center text-xs {planDays.has(wd.id)
							? 'text-foreground font-semibold'
							: 'text-muted-foreground'}"
						title={planDays.has(wd.id) ? `${wd.long} (geplant)` : wd.long}
					>
						{wd.short}
					</div>
				{/each}

				{#each weeks as week (week[0])}
					{#each week as date (date)}
						{@const day = byDate[date]}
						{@const done = trained(day)}
						{@const w = day?.workouts?.[0] ? workoutById[day.workouts[0]] : null}
						{@const outside = date.slice(0, 7) !== month}
						{@const isToday = date === todayIso}
						{@const isPlanned = planDays.has(weekdayId(date))}
						{@const label = `${formatDate(date)}${isToday ? ', heute' : ''}${done ? `, trainiert${w ? `: ${w.name}` : ''}` : isPlanned ? ', geplant' : ''}`}
						<button
							type="button"
							onclick={() => select(date)}
							aria-pressed={selected === date}
							aria-label={label}
							class="flex h-14 flex-col items-center justify-center gap-0.5 rounded-md text-sm transition-colors
								{selected === date ? 'ring-primary ring-2' : ''}
								{done ? 'bg-accent' : isPlanned ? 'bg-muted/60' : 'hover:bg-muted'}
								{outside ? 'opacity-40' : ''}"
						>
							<span
								class="tabular-nums {isToday
									? 'text-primary font-bold underline underline-offset-4'
									: ''}"
							>
								{Number(date.slice(8))}
							</span>
							{#if done}
								<span class="flex h-3.5 items-center gap-0.5 text-[10px] leading-none font-semibold">
									<span class="workout-dot slot-{w ? slotOf[w.id] : 0}" aria-hidden="true"></span>
									<span aria-hidden="true">{w ? w.name.charAt(0).toUpperCase() : '✓'}</span>
								</span>
							{:else}
								<span class="h-3.5" aria-hidden="true"></span>
							{/if}
						</button>
					{/each}
				{/each}
			</div>

			{#if workouts.length > 0}
				<ul class="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legende">
					{#each workouts as w (w.id)}
						<li class="flex items-center gap-1.5">
							<span class="workout-dot slot-{slotOf[w.id]}" aria-hidden="true"></span>
							{w.name}
						</li>
					{/each}
					{#if planned > 0}
						<li class="flex items-center gap-1.5">
							<span class="bg-muted inline-block size-3 rounded-sm border" aria-hidden="true"></span>
							geplanter Tag
						</li>
					{/if}
				</ul>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>{formatDate(selected)}{selected === todayIso ? ' · heute' : ''}</Card.Title>
			<Card.Description>
				{#if daysLoading && !info}
					Lade …
				{:else if trained(info)}
					{selectedWorkouts.length > 0
						? selectedWorkouts.map((w) => w.name).join(', ')
						: 'Training'}
				{:else if selected > todayIso}
					{planDays.has(weekdayId(selected)) ? 'Geplanter Trainingstag' : 'Kein Trainingstag geplant'}
				{:else}
					Kein Training eingetragen.
				{/if}
			</Card.Description>
		</Card.Header>

		{#if trained(info) || selected <= todayIso}
			<Card.Content class="flex flex-col gap-4">
				{#if trained(info)}
					<dl class="grid grid-cols-2 gap-3">
						<div class="bg-muted/50 rounded-lg p-3">
							<dt class="text-muted-foreground text-xs">Übungen</dt>
							<dd class="mt-1 text-lg font-semibold tabular-nums">{info.exercises}</dd>
						</div>
						<div class="bg-muted/50 rounded-lg p-3">
							<dt class="text-muted-foreground text-xs">Dauer</dt>
							<dd class="mt-1 text-lg font-semibold tabular-nums">
								{info.session?.duration ? formatDuration(info.session.duration) : '–'}
							</dd>
						</div>
					</dl>
				{/if}
				{#if selected <= todayIso}
					<DayWeight date={selected} />
				{/if}
			</Card.Content>
		{/if}

		{#if selected <= todayIso}
			<Card.Footer>
				<Button
					href="/training?date={selected}"
					variant={trained(info) ? 'outline' : 'default'}
					size="lg"
					class="h-11 w-full"
				>
					<PencilIcon class="size-4" />
					Eintragen
				</Button>
			</Card.Footer>
		{/if}
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Trainings pro Woche</Card.Title>
			<Card.Description>{monthLabel}</Card.Description>
		</Card.Header>
		<Card.Content>
			<ul class="divide-y overflow-hidden rounded-lg border">
				{#each weekRows as row (row.start)}
					<li class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
						<span>
							KW {row.kw}
							<span class="text-muted-foreground text-xs">
								· {shortDate(row.start)}–{shortDate(row.end)}
							</span>
						</span>
						<span class="font-semibold tabular-nums">
							{row.count}{planned > 0 ? ` / ${planned}` : ''}
						</span>
					</li>
				{/each}
			</ul>
		</Card.Content>
	</Card.Root>
</main>

<style>
	/* Kategoriefarben der Trainings (dataviz-Standardpalette, feste Reihenfolge,
	   je Modus eigene Stufe); slot-0 = ohne Zuordnung / ab dem neunten. */
	.workout-dot {
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 9999px;
		background: var(--dot);
	}
	.slot-0 {
		--dot: var(--muted-foreground);
	}
	.slot-1 {
		--dot: #2a78d6;
	}
	.slot-2 {
		--dot: #eb6834;
	}
	.slot-3 {
		--dot: #1baf7a;
	}
	.slot-4 {
		--dot: #eda100;
	}
	.slot-5 {
		--dot: #e87ba4;
	}
	.slot-6 {
		--dot: #008300;
	}
	.slot-7 {
		--dot: #6250d6;
	}
	.slot-8 {
		--dot: #e34948;
	}
	@media (prefers-color-scheme: dark) {
		.slot-1 {
			--dot: #3987e5;
		}
		.slot-2 {
			--dot: #d95926;
		}
		.slot-3 {
			--dot: #199e70;
		}
		.slot-4 {
			--dot: #c98500;
		}
		.slot-5 {
			--dot: #d55181;
		}
		.slot-7 {
			--dot: #9085e9;
		}
		.slot-8 {
			--dot: #e66767;
		}
	}
</style>
