<script>
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import ChartLineIcon from '@lucide/svelte/icons/chart-line';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { auth } from '$lib/pocketbase.svelte.js';
	import {
		loadBodyweight,
		saveBodyweight,
		deleteBodyweight,
		parseWeight,
		formatWeight,
		trainingError
	} from '$lib/training.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';

	// Koerpergewicht des im Kalender gewaehlten Tags: ein Wert pro Tag
	// (eindeutiger Index user+date), privat. Der Verlauf hat eine eigene Seite.

	/** @type {{ date: string }} */
	let { date } = $props();

	/** Grenzen wie in der Migration 1789822800. */
	const MIN_KG = 20;
	const MAX_KG = 400;

	const userId = $derived(auth.user?.id ?? '');

	// Aelteste zuerst, wie loadBodyweight sie liefert.
	let records = $state([]);
	let loading = $state(true);
	let loadError = $state(null);
	let error = $state(null);

	// Liest nur userId; schreibt nur die drei Felder (keine $effect-Schleife).
	$effect(() => {
		if (!userId) return;
		let cancelled = false;
		loading = true;
		loadError = null;
		loadBodyweight()
			.then((list) => {
				if (cancelled) return;
				records = list;
				loading = false;
			})
			.catch((err) => {
				if (cancelled) return;
				loadError = trainingError(err, 'Körpergewicht konnte nicht geladen werden.');
				loading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	let text = $state('');
	let busy = $state(false);

	// Ein anderer Tag beginnt mit leerem Feld. Liest nur `date`.
	$effect.pre(() => {
		void date;
		text = '';
	});

	// Ohne geladene Liste waere ein vorhandener Tageswert unbekannt.
	const blocked = $derived(loading || Boolean(loadError));
	const kg = $derived(parseWeight(text));
	const invalid = $derived(kg !== null && (Number.isNaN(kg) || kg < MIN_KG || kg > MAX_KG));
	const existing = $derived(records.find((r) => r.date === date));
	const latest = $derived(records[records.length - 1]);

	function insertSorted(record) {
		const idx = records.findIndex((r) => r.id === record.id);
		if (idx > -1) {
			records[idx] = record;
			return;
		}
		const at = records.findIndex((r) => r.date > record.date);
		if (at === -1) records.push(record);
		else records.splice(at, 0, record);
	}

	async function submit(e) {
		e.preventDefault();
		if (busy || blocked || kg === null || invalid) return;
		busy = true;
		error = null;
		try {
			const record = await saveBodyweight(date, kg, existing);
			insertSorted(record);
			text = '';
		} catch (err) {
			error = trainingError(err, 'Speichern fehlgeschlagen');
		} finally {
			busy = false;
		}
	}

	async function remove() {
		const record = existing;
		if (!record || busy) return;
		busy = true;
		error = null;
		try {
			await deleteBodyweight(record);
			const idx = records.findIndex((r) => r.id === record.id);
			if (idx > -1) records.splice(idx, 1);
		} catch (err) {
			error = trainingError(err, 'Löschen fehlgeschlagen');
		} finally {
			busy = false;
		}
	}
</script>

<form class="flex flex-col gap-2" onsubmit={submit}>
	<div class="flex items-center justify-between gap-2">
		<Label for="day-weight">Körpergewicht</Label>
		<Button href="/training/koerpergewicht" variant="link" class="h-auto p-0 text-xs">
			<ChartLineIcon class="size-3.5" />
			Verlauf
		</Button>
	</div>

	{#if existing}
		<div class="flex items-center gap-2">
			<span class="flex-1 text-sm">
				<span class="font-semibold tabular-nums">{formatWeight(existing.weight)}</span>
				<span class="text-muted-foreground">eingetragen</span>
			</span>
			<Button
				variant="ghost"
				size="icon"
				class="text-muted-foreground hover:text-destructive size-11"
				aria-label="Körpergewicht dieses Tags löschen"
				disabled={busy}
				onclick={remove}
			>
				<Trash2Icon class="size-4" />
			</Button>
		</div>
	{/if}

	<div class="flex gap-2">
		<Input
			id="day-weight"
			type="text"
			inputmode="decimal"
			bind:value={text}
			placeholder={existing
				? String(existing.weight).replace('.', ',')
				: latest
					? String(latest.weight).replace('.', ',')
					: '75,5'}
			aria-invalid={invalid || undefined}
			autocomplete="off"
			disabled={blocked}
			class="h-11 flex-1 text-right"
		/>
		<Button
			type="submit"
			variant="outline"
			class="h-11"
			disabled={busy || blocked || kg === null || invalid}
		>
			{existing ? 'Ersetzen' : 'Speichern'}
		</Button>
	</div>

	{#if invalid}
		<p class="text-destructive text-sm">
			Bitte ein Gewicht zwischen {MIN_KG} und {MAX_KG} kg eingeben, z.&nbsp;B. 75,5.
		</p>
	{/if}
	{#if loadError || error}
		<Alert.Root variant="destructive">
			<AlertCircleIcon />
			<Alert.Description>{loadError ?? error}</Alert.Description>
		</Alert.Root>
	{/if}
</form>
