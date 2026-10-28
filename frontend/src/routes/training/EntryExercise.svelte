<script>
	import { untrack } from 'svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import StickyNoteIcon from '@lucide/svelte/icons/sticky-note';
	import TrophyIcon from '@lucide/svelte/icons/trophy';
	import {
		kindOf,
		targetLabel,
		previousLog,
		logFor,
		setsOf,
		formatSets,
		formatDate,
		formatWeight,
		bestWeightBefore,
		suggestion,
		SETS_MAX,
		NOTE_MAX,
		DEFAULT_INCREMENT,
		sessionFor,
		today
	} from '$lib/training.svelte.js';
	import { timer, startRest, startWatch } from '$lib/training-timer.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { parseKg, parseReps, parseSeconds, toText, emptyRow } from './EntryDraft.js';

	// Eine Uebung auf der Eintragsseite. `draft` gehoert der Seite (gebunden),
	// `onchange` meldet jede Aenderung, damit die Seite den Entwurf sichert.
	let { exercise, date, draft = $bindable(), onchange } = $props();

	const kind = $derived(kindOf(exercise));
	const prev = $derived(previousLog(exercise.id, date));
	const step = $derived(exercise.increment > 0 ? exercise.increment : DEFAULT_INCREMENT);
	const stepText = $derived(toText(step));
	const sug = $derived(suggestion(exercise, date));
	const best = $derived(kind === 'weight' ? bestWeightBefore(exercise.id, date) : 0);
	/** Nach dem Speichern geleert: was fuer den Tag schon drinsteht. */
	const todayText = $derived(draft.fresh ? formatSets(exercise, logFor(exercise.id, date)) : '');

	// Platzhalter je Zeile: der Satz vom letzten Mal an derselben Stelle,
	// Aufwaermsaetze und Arbeitssaetze getrennt gezaehlt. Hat man heute mehr
	// Arbeitssaetze als damals, gilt der letzte. Ohne Verlauf das Soll.
	const hints = $derived.by(() => {
		const sets = setsOf(prev);
		const warm = sets.filter((s) => s.warmup);
		const work = sets.filter((s) => !s.warmup);
		let w = 0;
		let a = 0;
		return draft.rows.map((r) => {
			const s = r.warmup ? warm[a++] : (work[w++] ?? work[work.length - 1]);
			return {
				weight: s?.weight ?? null,
				reps: s?.reps ?? (r.warmup || kind === 'time' ? null : exercise.reps || null),
				seconds: s?.seconds ?? (r.warmup || kind !== 'time' ? null : exercise.reps || null)
			};
		});
	});

	const labels = $derived.by(() => {
		let n = 0;
		return draft.rows.map((r) => (r.warmup ? 'A' : String(++n)));
	});

	const draftTop = $derived(
		Math.max(
			0,
			...draft.rows
				.filter((r) => !r.warmup)
				.map((r) => parseKg(r.weight))
				.filter((kg) => kg > 0)
		)
	);
	const record = $derived(kind === 'weight' && best > 0 && draftTop > best);
	const sugApplied = $derived(
		!!sug &&
			draft.rows.some((r) => !r.warmup) &&
			draft.rows.every((r) => r.warmup || parseKg(r.weight) === sug.weight)
	);

	let noteOpen = $state(untrack(() => draft.note !== ''));

	function changed() {
		onchange?.();
	}

	/** Haken: leere Felder aus dem Platzhalter fuellen, Pause starten. */
	function toggleDone(i) {
		const row = draft.rows[i];
		if (row.done) {
			row.done = false;
			changed();
			return;
		}
		const h = hints[i];
		if (kind === 'time') {
			if (row.seconds.trim() === '' && h.seconds != null) row.seconds = toText(h.seconds);
		} else {
			// Bei Koerpergewicht ist 0 kg "kein Zusatz" und bleibt leer.
			if (row.weight.trim() === '' && h.weight != null && (kind === 'weight' || h.weight > 0)) {
				row.weight = toText(h.weight);
			}
			if (row.reps.trim() === '' && h.reps != null) row.reps = toText(h.reps);
		}
		row.done = true;
		changed();
		if (exercise.rest > 0) startRest(exercise.rest);
		// "Training starten" vergessen: ein Haken von heute startet die Stoppuhr --
		// aber nicht mehr nach "Beenden" (dann steht schon eine Dauer). Ein zweites
		// Training am Tag startet man von Hand.
		if (!timer.watch && date === today() && !sessionFor(date)) startWatch(date, exercise.workout);
	}

	/** Alle Arbeitsgewichte um eine Steigerung rauf oder runter. */
	function shift(dir) {
		draft.rows.forEach((r, i) => {
			if (r.warmup) return;
			let base = parseKg(r.weight);
			if (base === null) base = hints[i].weight;
			if (base === null || Number.isNaN(base)) return;
			const kg = Math.round((base + dir * step) * 100) / 100;
			r.weight = toText(Math.min(1000, Math.max(0, kg)));
		});
		changed();
	}

	function applySuggestion() {
		if (!sug) return;
		for (const r of draft.rows) if (!r.warmup) r.weight = toText(sug.weight);
		changed();
	}

	function addRow(warmup) {
		if (draft.rows.length >= SETS_MAX) return;
		if (warmup) {
			// Aufwaermen steht vor den Arbeitssaetzen.
			const at = draft.rows.findIndex((r) => !r.warmup);
			draft.rows.splice(at === -1 ? draft.rows.length : at, 0, emptyRow(true));
		} else {
			draft.rows.push(emptyRow());
		}
		changed();
	}

	function removeRow(i) {
		draft.rows.splice(i, 1);
		changed();
	}

	const full = $derived(draft.rows.length >= SETS_MAX);
	const kgPlaceholder = (h) => (h.weight != null ? toText(h.weight) : '');
</script>

<li class="flex flex-col gap-2 px-3 py-3">
	<div class="flex items-start justify-between gap-2">
		<div class="min-w-0">
			<a
				href="/training/uebung/{exercise.id}"
				class="block truncate py-1 font-medium underline-offset-4 hover:underline"
			>
				{exercise.name}
			</a>
			<p class="text-muted-foreground text-xs">{targetLabel(exercise)}</p>
		</div>
		{#if record}
			<Badge class="mt-1.5 shrink-0">
				<TrophyIcon />
				Neuer Bestwert
			</Badge>
		{/if}
	</div>

	<p class="text-muted-foreground text-xs">
		{#if prev}
			Grau: letztes Mal · {formatDate(prev.date)} – Haken übernimmt
		{:else}
			Noch nichts eingetragen
		{/if}
	</p>

	{#if todayText}
		<p class="text-muted-foreground text-sm">
			Heute gespeichert:
			<span class="text-foreground font-semibold tabular-nums">{todayText}</span>
			<span class="text-xs">· neue Sätze kommen dazu</span>
		</p>
	{/if}

	{#if sug && !sugApplied}
		<div class="bg-muted flex items-center justify-between gap-2 rounded-md py-1 pr-1 pl-3 text-sm">
			<p class="min-w-0">
				Vorschlag: <span class="font-semibold tabular-nums">{formatWeight(sug.weight)}</span>
				<span class="text-muted-foreground">– beim letzten Mal alle Wdh. geschafft</span>
			</p>
			<Button variant="secondary" class="bg-background h-11 shrink-0" onclick={applySuggestion}>
				Übernehmen
			</Button>
		</div>
	{/if}

	{#if draft.rows.length > 0}
		<div class="flex flex-col gap-1.5">
			<div class="text-muted-foreground flex items-center gap-1.5 text-xs" aria-hidden="true">
				<span class="w-6 text-center">Satz</span>
				{#if kind === 'weight'}
					<span class="w-20 text-center">kg</span>
					<span class="w-16 text-center">Wdh.</span>
				{:else if kind === 'bodyweight'}
					<span class="w-16 text-center">Wdh.</span>
					<span class="w-20 text-center">+kg</span>
				{:else}
					<span class="w-24 text-center">Sekunden</span>
				{/if}
			</div>
			{#each draft.rows as row, i}
				{@const h = hints[i]}
				{@const label = labels[i]}
				{@const name = row.warmup ? 'Aufwärmsatz' : `Satz ${label}`}
				<div class="flex items-center gap-1.5">
					<span
						class="w-6 text-center text-sm font-semibold tabular-nums {row.warmup
							? 'text-muted-foreground bg-muted rounded'
							: ''}"
						title={row.warmup ? 'Aufwärmsatz' : undefined}
					>
						{label}
					</span>
					{#if kind === 'time'}
						<Input
							type="text"
							inputmode="numeric"
							bind:value={row.seconds}
							oninput={changed}
							placeholder={toText(h.seconds)}
							aria-label="{name}: Sekunden"
							aria-invalid={Number.isNaN(parseSeconds(row.seconds)) || undefined}
							autocomplete="off"
							class="h-11 w-24 text-right"
						/>
					{:else if kind === 'bodyweight'}
						<Input
							type="text"
							inputmode="numeric"
							bind:value={row.reps}
							oninput={changed}
							placeholder={toText(h.reps)}
							aria-label="{name}: Wiederholungen"
							aria-invalid={Number.isNaN(parseReps(row.reps)) || undefined}
							autocomplete="off"
							class="h-11 w-16 text-right"
						/>
						<Input
							type="text"
							inputmode="decimal"
							bind:value={row.weight}
							oninput={changed}
							placeholder={h.weight > 0 ? toText(h.weight) : '+kg'}
							aria-label="{name}: Zusatzgewicht in Kilogramm"
							aria-invalid={Number.isNaN(parseKg(row.weight)) || undefined}
							autocomplete="off"
							class="h-11 w-20 text-right"
						/>
					{:else}
						<Input
							type="text"
							inputmode="decimal"
							bind:value={row.weight}
							oninput={changed}
							placeholder={kgPlaceholder(h)}
							aria-label="{name}: Gewicht in Kilogramm"
							aria-invalid={Number.isNaN(parseKg(row.weight)) || undefined}
							autocomplete="off"
							class="h-11 w-20 text-right"
						/>
						<Input
							type="text"
							inputmode="numeric"
							bind:value={row.reps}
							oninput={changed}
							placeholder={toText(h.reps)}
							aria-label="{name}: Wiederholungen"
							aria-invalid={Number.isNaN(parseReps(row.reps)) || undefined}
							autocomplete="off"
							class="h-11 w-16 text-right"
						/>
					{/if}
					<Button
						variant={row.done ? 'default' : 'outline'}
						size="icon"
						class="ml-auto size-11 touch-manipulation"
						aria-label="{name} geschafft"
						aria-pressed={row.done}
						onclick={() => toggleDone(i)}
					>
						<CheckIcon class="size-5" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						class="text-muted-foreground size-11"
						aria-label="{name} entfernen"
						onclick={() => removeRow(i)}
					>
						<XIcon />
					</Button>
				</div>
			{/each}
		</div>
	{/if}

	<div class="flex flex-wrap items-center gap-1.5">
		<Button variant="outline" class="h-11" disabled={full} onclick={() => addRow(false)}>
			<PlusIcon />
			Satz
		</Button>
		<Button variant="outline" class="h-11" disabled={full} onclick={() => addRow(true)}>
			<PlusIcon />
			Aufwärmsatz
		</Button>
		<!-- Vorerst ausgeblendet; shift() bleibt fuer spaeter. -->
		{#if false && kind === 'weight'}
			<Button
				variant="outline"
				class="h-11 tabular-nums"
				aria-label="Alle Arbeitsgewichte minus {stepText} kg"
				onclick={() => shift(-1)}
			>
				<MinusIcon />{stepText}
			</Button>
			<Button
				variant="outline"
				class="h-11 tabular-nums"
				aria-label="Alle Arbeitsgewichte plus {stepText} kg"
				onclick={() => shift(1)}
			>
				<PlusIcon />{stepText}
			</Button>
		{/if}
		<Button
			variant={noteOpen ? 'secondary' : 'ghost'}
			class="h-11"
			aria-expanded={noteOpen}
			onclick={() => (noteOpen = !noteOpen)}
		>
			<StickyNoteIcon />
			Notiz{draft.note.trim() && !noteOpen ? ' •' : ''}
		</Button>
	</div>

	{#if noteOpen}
		<Textarea
			bind:value={draft.note}
			oninput={changed}
			maxlength={NOTE_MAX}
			rows={2}
			placeholder="z. B. Griffbreite, Gefühl, Schmerzen …"
			aria-label="Notiz zu {exercise.name}"
		/>
	{/if}
</li>
