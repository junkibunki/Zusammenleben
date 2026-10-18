<script>
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import CheckIcon from '@lucide/svelte/icons/check';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { auth } from '$lib/pocketbase.svelte.js';
	import {
		loadBodyweight,
		saveBodyweight,
		deleteBodyweight,
		parseWeight,
		formatDate,
		formatWeight,
		today,
		trainingError
	} from '$lib/training.svelte.js';
	import TrainingChart from '$lib/TrainingChart.svelte';
	import TrainingTabs from '../TrainingTabs.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';

	// Koerpergewicht: ein Wert pro Tag (eindeutiger Index user+date), privat.

	/** Grenzen wie in der Migration 1789822800. */
	const MIN_KG = 20;
	const MAX_KG = 400;

	const userId = $derived(auth.user?.id ?? '');

	// Aelteste zuerst, wie loadBodyweight sie liefert.
	let records = $state([]);
	let loading = $state(true);
	let loadError = $state(null);

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

	const todayIso = today();
	let date = $state(todayIso);
	let text = $state('');
	let busy = $state(false);
	let error = $state(null);
	let saved = $state(false);

	const kg = $derived(parseWeight(text));
	const invalid = $derived(kg !== null && (Number.isNaN(kg) || kg < MIN_KG || kg > MAX_KG));
	const existing = $derived(records.find((r) => r.date === date));
	const dateOk = $derived(/^\d{4}-\d{2}-\d{2}$/.test(date) && date <= todayIso);

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
		if (busy || kg === null || invalid || !dateOk) return;
		busy = true;
		error = null;
		saved = false;
		try {
			const record = await saveBodyweight(date, kg, existing);
			insertSorted(record);
			text = '';
			saved = true;
		} catch (err) {
			error = trainingError(err, 'Speichern fehlgeschlagen');
		} finally {
			busy = false;
		}
	}

	// --- Loeschen ---------------------------------------------------------------

	let confirmOpen = $state(false);
	let pending = $state(null);

	function askDelete(record) {
		pending = record;
		confirmOpen = true;
	}

	async function confirmDelete() {
		const record = pending;
		if (!record) return;
		// Selbst schliessen, und zwar vor dem await: AlertDialog.Action schliesst
		// mit eigenem onclick nicht von allein (docs/pitfalls/designsystem.md).
		confirmOpen = false;
		error = null;
		saved = false;
		try {
			await deleteBodyweight(record);
			const idx = records.findIndex((r) => r.id === record.id);
			if (idx > -1) records.splice(idx, 1);
		} catch (err) {
			error = trainingError(err, 'Löschen fehlgeschlagen');
		}
	}

	// --- Auswertung -------------------------------------------------------------

	const points = $derived(records.map((r) => ({ date: r.date, value: r.weight })));
	const newestFirst = $derived([...records].reverse());
	const latest = $derived(records[records.length - 1]);

	function minusDays(dateIso, n) {
		const [y, m, d] = dateIso.split('-').map(Number);
		const x = new Date(y, m - 1, d - n, 12);
		return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
	}

	/**
	 * Veraenderung des juengsten Werts gegenueber dem juengsten Wert, der
	 * mindestens `n` Tage davor liegt; null, wenn es so weit zurueck nichts gibt.
	 */
	function changeOver(n) {
		if (!latest) return null;
		const limit = minusDays(latest.date, n);
		let base;
		for (const r of records) {
			if (r.date <= limit) base = r;
		}
		if (!base) return null;
		return { delta: Math.round((latest.weight - base.weight) * 10) / 10, since: base.date };
	}

	const changes = $derived([
		{ label: '7 Tage', change: changeOver(7) },
		{ label: '30 Tage', change: changeOver(30) }
	]);

	function signed(delta) {
		const n = Math.abs(delta).toLocaleString('de-DE', { maximumFractionDigits: 1 });
		return delta > 0 ? `+${n} kg` : delta < 0 ? `−${n} kg` : `±0 kg`;
	}

	const thisYear = new Date().getFullYear();
	function dateLabel(d) {
		const year = Number(String(d).slice(0, 4));
		return year === thisYear ? formatDate(d) : `${formatDate(d)}${year}`;
	}
</script>

<main class="flex flex-1 flex-col gap-4 px-3 py-4">
	<TrainingTabs />

	{#if loadError}
		<Alert.Root variant="destructive">
			<AlertCircleIcon />
			<Alert.Description>{loadError}</Alert.Description>
		</Alert.Root>
	{/if}

	<Card.Root>
		<form class="flex flex-col gap-(--card-spacing)" onsubmit={submit}>
			<Card.Header>
				<Card.Title>Körpergewicht eintragen</Card.Title>
				<Card.Description>Ein Wert pro Tag; ein neuer ersetzt den alten.</Card.Description>
			</Card.Header>

			<Card.Content class="flex flex-col gap-4">
				<div class="grid grid-cols-2 gap-3">
					<div class="grid gap-2">
						<Label for="bw-date">Datum</Label>
						<Input
							id="bw-date"
							type="date"
							bind:value={date}
							max={todayIso}
							oninput={() => (saved = false)}
							class="h-11"
						/>
					</div>
					<div class="grid gap-2">
						<Label for="bw-weight">Gewicht (kg)</Label>
						<Input
							id="bw-weight"
							type="text"
							inputmode="decimal"
							bind:value={text}
							oninput={() => (saved = false)}
							placeholder={existing
								? String(existing.weight).replace('.', ',')
								: latest
									? String(latest.weight).replace('.', ',')
									: '75,5'}
							aria-invalid={invalid || undefined}
							autocomplete="off"
							class="h-11 text-right"
						/>
					</div>
				</div>

				{#if existing}
					<p class="text-muted-foreground text-sm">
						Für {formatDate(date)} steht schon {formatWeight(existing.weight)} drin — Speichern ersetzt
						den Wert.
					</p>
				{/if}

				{#if invalid}
					<Alert.Root variant="destructive">
						<AlertCircleIcon />
						<Alert.Description>
							Bitte ein Gewicht zwischen {MIN_KG} und {MAX_KG} kg eingeben, z.&nbsp;B. 75,5.
						</Alert.Description>
					</Alert.Root>
				{/if}
				{#if !dateOk}
					<Alert.Root variant="destructive">
						<AlertCircleIcon />
						<Alert.Description>Bitte ein Datum bis heute wählen.</Alert.Description>
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

			<Card.Footer>
				<Button
					type="submit"
					size="lg"
					class="h-11 w-full"
					disabled={busy || kg === null || invalid || !dateOk}
				>
					{busy ? 'Speichern …' : existing ? 'Wert ersetzen' : 'Speichern'}
				</Button>
			</Card.Footer>
		</form>
	</Card.Root>

	{#if loading}
		<p class="text-muted-foreground text-sm">Lade …</p>
	{:else if !loadError && records.length === 0}
		<p class="text-muted-foreground text-sm">Noch kein Körpergewicht eingetragen.</p>
	{:else if records.length > 0}
		<Card.Root>
			<Card.Header>
				<Card.Title>Verlauf</Card.Title>
				<Card.Description>
					Zuletzt {formatWeight(latest.weight)} am {dateLabel(latest.date)}
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<TrainingChart {points} unit="kg" label="Körpergewicht" format={formatWeight} />

				<dl class="grid grid-cols-2 gap-3">
					{#each changes as c (c.label)}
						<div class="bg-muted/50 rounded-lg p-3">
							<dt class="text-muted-foreground text-xs">Veränderung {c.label}</dt>
							<dd class="mt-1">
								{#if c.change}
									<span class="block text-lg font-semibold tabular-nums">
										{signed(c.change.delta)}
									</span>
									<span class="text-muted-foreground text-xs">
										seit {dateLabel(c.change.since)}
									</span>
								{:else}
									<span class="text-muted-foreground block text-lg">–</span>
									<span class="text-muted-foreground text-xs">noch zu wenig Werte</span>
								{/if}
							</dd>
						</div>
					{/each}
				</dl>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Alle Einträge</Card.Title>
			</Card.Header>
			<Card.Content>
				<ul class="divide-y overflow-hidden rounded-lg border">
					{#each newestFirst as r (r.id)}
						<li class="flex items-center gap-3 py-1 pr-1 pl-3">
							<span class="flex-1 text-sm">{dateLabel(r.date)}</span>
							<span class="text-sm font-semibold tabular-nums">{formatWeight(r.weight)}</span>
							<Button
								variant="ghost"
								size="icon"
								class="text-muted-foreground hover:text-destructive size-11"
								aria-label="Eintrag vom {dateLabel(r.date)} löschen"
								onclick={() => askDelete(r)}
							>
								<Trash2Icon class="size-4" />
							</Button>
						</li>
					{/each}
				</ul>
			</Card.Content>
		</Card.Root>
	{/if}
</main>

<AlertDialog.Root bind:open={confirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Eintrag löschen?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if pending}
					{formatWeight(pending.weight)} vom {dateLabel(pending.date)} wird gelöscht.
				{/if}
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
