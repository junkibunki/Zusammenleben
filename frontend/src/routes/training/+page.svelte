<script>
	import { tick, untrack } from 'svelte';
	import { page } from '$app/state';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import CheckIcon from '@lucide/svelte/icons/check';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import PlayIcon from '@lucide/svelte/icons/play';
	import SquareIcon from '@lucide/svelte/icons/square';
	import XIcon from '@lucide/svelte/icons/x';
	import TimerIcon from '@lucide/svelte/icons/timer';
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
		kindOf,
		sessionFor,
		saveSession,
		formatDuration,
		today,
		formatDate,
		trainingError
	} from '$lib/training.svelte.js';
	import {
		timer,
		startTimers,
		startWatch,
		watchElapsed,
		clearWatch
	} from '$lib/training-timer.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import TrainingTabs from './TrainingTabs.svelte';
	import EntryMode from './EntryMode.svelte';
	import EntryExercise from './EntryExercise.svelte';
	import EntryRestTimer from './EntryRestTimer.svelte';
	import EntryCheer, { makeCheer } from './EntryCheer.svelte';
	import {
		draftFrom,
		freshDraft,
		savedEntry,
		parseRows,
		draftKey,
		readDrafts,
		writeDrafts,
		REPS_LIMIT,
		SECONDS_LIMIT
	} from './EntryDraft.js';

	// Nur das Eintragen; Trainings, Uebungen und Trainingstage stehen unter
	// /training/einstellungen.

	const userId = $derived(auth.user?.id ?? '');

	$effect(() => {
		if (userId) return syncTraining(userId);
	});

	$effect(() => {
		if (userId) return startTimers(userId);
	});

	/** `?date=YYYY-MM-DD` aus dem Kalender; ungueltig oder Zukunft -> ''. */
	function validDate(value) {
		if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
		const [y, m, d] = value.split('-').map(Number);
		const dt = new Date(y, m - 1, d);
		if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return '';
		return value > today() ? '' : value;
	}

	const queryDate = $derived(validDate(page.url.searchParams.get('date')));

	let date = $state(validDate(page.url.searchParams.get('date')) || today());
	let busy = $state(false);
	let error = $state(null);
	let saved = $state(false);
	let watchBusy = $state(false);
	/** Jubel nach dem Speichern (EntryCheer), null = keiner. */
	let cheer = $state(null);
	/** Zaehlt hoch, wenn das Formular geleert wird: die Zeilen werden neu aufgebaut. */
	let formGen = $state(0);

	// Kommt man ueber einen anderen Link auf dieselbe Seite (Kalender, Tab),
	// gilt dessen Datum. `lastQuery` ist bewusst kein $state.
	let lastQuery = untrack(() => queryDate);
	$effect(() => {
		const q = queryDate;
		if (q === lastQuery) return;
		lastQuery = q;
		date = q || today();
		pickDate();
	});

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

	// --- Entwuerfe ------------------------------------------------------------

	// Der gespeicherte Stand aller Uebungen an `date`, so normalisiert, wie ein
	// Entwurf beim Speichern aussaehe. Als String, damit der Effekt unten nur bei
	// echter Aenderung feuert. Ueber *alle* Uebungen, nicht nur die des
	// gewaehlten Trainings: ein Wechsel des Trainings verwirft keine Eingaben.
	const savedJson = $derived(
		JSON.stringify(
			Object.fromEntries(
				training.exercises.map((e) => [e.id, savedEntry(logFor(e.id, date), kindOf(e))])
			)
		)
	);
	const savedMap = $derived(JSON.parse(savedJson));

	let drafts = $state({});

	// Steuerung, kein $state: fuer welchen Nutzer+Tag `drafts` gilt und welcher
	// gespeicherte Stand je Uebung zuletzt eingeflossen ist.
	let draftsFor = '';
	let previous = {};

	// Entwuerfe aus dem gespeicherten Stand bauen. Liest `drafts` nur
	// ungetrackt -- er schreibt es ja (CLAUDE.md, $effect-Schleifen).
	// - neuer Tag/Nutzer: gesicherter Entwurf aus dem localStorage, sonst gespeichert;
	// - sonst nur die Uebungen neu setzen, deren gespeicherter Stand sich
	//   geaendert hat -- ein teilweise gescheitertes Speichern laesst die
	//   uebrigen Eingaben stehen.
	$effect(() => {
		const next = savedMap;
		const key = userId && date ? draftKey(userId, date) : '';
		untrack(() => {
			const fresh = key !== draftsFor;
			let stored = null;
			const merged = {};
			const seen = {};
			for (const ex of training.exercises) {
				const id = ex.id;
				const now = JSON.stringify(next[id] ?? null);
				seen[id] = now;
				if (!fresh && id in drafts && previous[id] === now) {
					merged[id] = drafts[id];
					continue;
				}
				if (fresh || !(id in previous)) {
					stored ??= key ? readDrafts(key) : {};
					if (stored[id]) {
						merged[id] = stored[id];
						continue;
					}
				}
				merged[id] = draftFrom(ex, logFor(id, date), kindOf(ex), previousLog(id, date));
			}
			previous = seen;
			draftsFor = key;
			drafts = merged;
		});
	});

	// Pro Uebung: die Saetze, wie sie gespeichert wuerden, und ob sie sich vom
	// gespeicherten Stand unterscheiden. Ein geleerter Entwurf (`fresh`) ist nur
	// dirty, wenn etwas drinsteht -- leer heisst dort nicht "Eintrag loeschen".
	const status = $derived(
		Object.fromEntries(
			training.exercises.map((ex) => {
				const d = drafts[ex.id];
				if (!d) return [ex.id, null];
				const { sets, bad } = parseRows(kindOf(ex), d.rows);
				const note = d.note.trim();
				if (d.fresh) {
					return [ex.id, { sets, note, bad, dirty: bad || sets.length > 0 || note !== '', fresh: true }];
				}
				const was = savedMap[ex.id] ?? { sets: [], note: '' };
				const dirty =
					bad || JSON.stringify({ sets, note }) !== JSON.stringify({ sets: was.sets, note: was.note });
				return [ex.id, { sets, note, bad, dirty, fresh: false }];
			})
		)
	);
	const dirty = $derived(Object.values(status).some((s) => s?.dirty));
	const invalidNames = $derived(
		training.exercises.filter((ex) => status[ex.id]?.bad).map((ex) => ex.name)
	);
	const dirtyWorkouts = $derived(
		new Set(training.exercises.filter((ex) => status[ex.id]?.dirty).map((ex) => ex.workout))
	);

	// Entwuerfe sichern, damit sie das Schliessen der App ueberleben. Aus den
	// Handlern statt aus einem $effect; per Microtask, weil `oninput` vor dem
	// Uebernehmen durch bind:value laufen kann.
	let persistQueued = false;
	function persist() {
		persistQueued = false;
		if (!userId || !date) return;
		const out = {};
		for (const ex of training.exercises) {
			if (status[ex.id]?.dirty && drafts[ex.id]) out[ex.id] = $state.snapshot(drafts[ex.id]);
		}
		writeDrafts(draftKey(userId, date), out);
	}

	function changed() {
		saved = false;
		if (persistQueued) return;
		persistQueued = true;
		queueMicrotask(persist);
	}

	async function submit(e) {
		e.preventDefault();
		if (invalidNames.length > 0 || !dirty || !date) return;
		const entries = {};
		for (const ex of training.exercises) {
			const s = status[ex.id];
			if (s?.dirty) entries[ex.id] = { sets: s.sets, note: s.note, append: s.fresh };
		}
		const key = draftKey(userId, date);
		const savedDate = date;
		busy = true;
		error = null;
		saved = false;
		try {
			await saveDay(savedDate, entries);
			writeDrafts(key, null);
			// Erst den Effekt oben nachziehen lassen (er baut die Entwuerfe aus dem
			// neuen Stand), dann leeren -- sonst ueberschriebe er das leere Formular.
			await tick();
			clearForm();
			saved = true;
			// Laeuft die Stoppuhr fuer diesen Tag, ist das Training damit zu Ende.
			if (timer.watch?.date === savedDate) {
				try {
					await saveWatch();
				} catch (err) {
					error = trainingError(err, 'Gespeichert, aber die Dauer nicht – bitte „Beenden“ tippen.');
					return;
				}
			}
			cheer = makeCheer();
		} catch (err) {
			error = trainingError(err, 'Speichern fehlgeschlagen');
			// Was durchging, ist nicht mehr dirty; der Rest bleibt gesichert.
			queueMicrotask(persist);
		} finally {
			busy = false;
		}
	}

	/**
	 * Nach dem Speichern: alle Zeilen leer, als neue Saetze fuer den Tag (siehe
	 * `fresh` in EntryDraft.js). `previous` stimmt nach tick() mit dem gespeicherten
	 * Stand ueberein, also laesst der Effekt oben die leeren Entwuerfe stehen.
	 */
	function clearForm() {
		const next = {};
		for (const ex of training.exercises) next[ex.id] = freshDraft(ex, kindOf(ex));
		drafts = next;
		formGen += 1;
	}

	// --- Dauer ----------------------------------------------------------------

	const isToday = $derived(date === today());
	const session = $derived(sessionFor(date));
	const watchHere = $derived(timer.watch?.date === date);

	function startTraining() {
		startWatch(date, workout?.id ?? '');
	}

	/** Vergessene Stoppuhr verwerfen, ohne eine Dauer zu speichern. */
	function discardTraining() {
		if (!timer.watch || watchBusy) return;
		if (!confirm('Stoppuhr verwerfen? Die Dauer wird nicht gespeichert.')) return;
		clearWatch();
	}

	/**
	 * Stoppuhr beenden und die Dauer speichern; ein zweites Training am selben
	 * Tag zaehlt dazu. Wirft bei einem Fehler, die Stoppuhr laeuft dann weiter.
	 */
	async function saveWatch() {
		const w = timer.watch;
		if (!w || watchBusy) return;
		const seconds = (Date.now() - w.start) / 1000;
		const base = sessionFor(w.date)?.duration ?? 0;
		const workoutId = w.date === date ? (workout?.id ?? w.workout) : w.workout;
		watchBusy = true;
		try {
			await saveSession(w.date, workoutId, base + seconds);
			clearWatch();
		} finally {
			watchBusy = false;
		}
	}

	/** "Beenden" von Hand. */
	async function endTraining() {
		if (!timer.watch || watchBusy) return;
		error = null;
		try {
			await saveWatch();
		} catch (err) {
			error = trainingError(err, 'Dauer konnte nicht gespeichert werden.');
		}
	}

	const restVisible = $derived(timer.restEnd > 0 || timer.restDoneAt > 0);
</script>

<main class="flex flex-1 flex-col gap-4 px-3 py-4 {restVisible ? 'pb-32' : ''}">
	<TrainingTabs />
	<EntryMode />

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
				<Card.Description>Sätze abhaken – die Pause läuft von selbst.</Card.Description>
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

				{#if !training.loading && workouts.length > 0}
					<div class="col-span-full mt-2 flex flex-wrap items-center gap-2">
						{#if watchHere}
							<TimerIcon class="text-primary size-5" />
							<span class="text-xl font-semibold tabular-nums" role="timer">
								{formatDuration((session?.duration ?? 0) + watchElapsed())}
							</span>
							<Button
								variant="outline"
								class="ml-auto h-11"
								disabled={watchBusy}
								onclick={endTraining}
							>
								<SquareIcon />
								{watchBusy ? 'Speichern …' : 'Beenden'}
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="text-muted-foreground size-11"
								disabled={watchBusy}
								onclick={discardTraining}
								aria-label="Stoppuhr verwerfen"
							>
								<XIcon class="size-5" />
							</Button>
						{:else}
							{#if session}
								<span class="text-muted-foreground text-sm">
									Dauer:
									<span class="text-foreground font-semibold tabular-nums">
										{formatDuration(session.duration)}
									</span>
								</span>
							{/if}
							{#if timer.watch}
								<span class="text-muted-foreground text-sm">
									Training vom {formatDate(timer.watch.date)} läuft:
									<span class="text-foreground font-semibold tabular-nums">
										{formatDuration(watchElapsed())}
									</span>
								</span>
								<Button
									variant="outline"
									class="ml-auto h-11"
									disabled={watchBusy}
									onclick={endTraining}
								>
									<SquareIcon />
									Beenden
								</Button>
								<Button
									variant="ghost"
									size="icon"
									class="text-muted-foreground size-11"
									disabled={watchBusy}
									onclick={discardTraining}
									aria-label="Stoppuhr verwerfen"
								>
									<XIcon class="size-5" />
								</Button>
							{:else if isToday}
								<Button variant="outline" class="ml-auto h-11" onclick={startTraining}>
									<PlayIcon />
									Training starten
								</Button>
							{/if}
						{/if}
					</div>
				{/if}
			</Card.Header>

			<Card.Content class="flex flex-col gap-4">
				<div class="grid grid-cols-2 gap-2">
					<div class="grid min-w-0 gap-2">
						<Label for="training-date">Datum</Label>
						<Input
							id="training-date"
							type="date"
							bind:value={date}
							max={today()}
							oninput={pickDate}
							class="h-11 min-w-0"
						/>
					</div>

					{#if !training.loading && workouts.length > 0}
						<div class="grid min-w-0 gap-2">
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
										<Select.Item value={w.id} label={w.name}>
											{w.name}
											{#if dirtyWorkouts.has(w.id)}
												<span class="text-muted-foreground text-xs">· ungespeichert</span>
											{/if}
										</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					{/if}
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
				{:else if exercises.length === 0}
					<p class="text-muted-foreground text-sm">„{workout?.name}“ hat noch keine Übungen.</p>
				{:else}
					<ul class="divide-y rounded-lg border">
						{#each exercises as ex (ex.id)}
							{#if drafts[ex.id]}
								<!-- Neu pro Tag und nach jedem Leeren: der Zustand der Zeile (z.B. Notiz
								     auf/zu) gehoert zum Tag bzw. zum Entwurf. -->
								{#key `${date}:${formGen}`}
									<EntryExercise
										exercise={ex}
										{date}
										bind:draft={drafts[ex.id]}
										onchange={changed}
									/>
								{/key}
							{/if}
						{/each}
					</ul>
				{/if}

				{#if invalidNames.length > 0}
					<Alert.Root variant="destructive">
						<AlertCircleIcon />
						<Alert.Description>
							Bitte nur Zahlen eingeben: kg bis 1000 (z.&nbsp;B. 42,5), Wdh. bis {REPS_LIMIT},
							Sekunden bis {SECONDS_LIMIT}. Betrifft: {invalidNames.join(', ')}.
						</Alert.Description>
					</Alert.Root>
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

			{#if exercises.length > 0 || dirty}
				<Card.Footer>
					<Button
						type="submit"
						size="lg"
						class="h-11 w-full"
						disabled={busy || invalidNames.length > 0 || !dirty || !date}
					>
						{busy ? 'Speichern …' : 'Training speichern'}
					</Button>
				</Card.Footer>
			{/if}
		</form>
	</Card.Root>
</main>

<EntryRestTimer />
<EntryCheer {cheer} onclose={() => (cheer = null)} />
