<script>
	import { beforeNavigate } from '$app/navigation';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import InfoIcon from '@lucide/svelte/icons/info';
	import LockIcon from '@lucide/svelte/icons/lock';
	import PlayIcon from '@lucide/svelte/icons/play';
	import SquareIcon from '@lucide/svelte/icons/square';
	import XIcon from '@lucide/svelte/icons/x';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { auth } from '$lib/pocketbase.svelte.js';
	import { formatDate, formatDuration } from '$lib/training.svelte.js';
	import {
		cardio,
		KINDS,
		MAX_ACCURACY,
		syncCardio,
		startRun,
		stopRun,
		saveRun,
		discardRun,
		runElapsed,
		livePoints,
		kindLabel,
		formatDistance,
		formatPace
	} from '$lib/cardio.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import TrainingTabs from '../TrainingTabs.svelte';
	import EntryMode from '../EntryMode.svelte';
	import CardioMap from './CardioMap.svelte';
	import CardioLock from './CardioLock.svelte';

	const KIND_KEY = 'training.cardio.kind';

	const userId = $derived(auth.user?.id ?? '');

	$effect(() => {
		if (userId) return syncCardio(userId);
	});

	let kind = $state(readKind());
	let locked = $state(false);

	function readKind() {
		try {
			const k = localStorage.getItem(KIND_KEY);
			return KINDS.some((x) => x.id === k) ? k : 'run';
		} catch {
			return 'run';
		}
	}

	function pickKind(id) {
		kind = id;
		try {
			localStorage.setItem(KIND_KEY, id);
		} catch {
			// Merkt es sich eben nicht.
		}
	}

	const run = $derived(cardio.run);
	const tracking = $derived(!!run && !run.stoppedAt);
	const elapsed = $derived(runElapsed());
	// Liest `version`, damit die Karte nach Start/Verwerfen das neue Array bekommt.
	const points = $derived((cardio.version, livePoints()));

	function start() {
		startRun(kind);
	}

	function lock() {
		locked = true;
		// Vollbild blendet die Statusleiste aus; iOS kennt es fuer Seiten nicht.
		try {
			document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {});
		} catch {
			// Egal -- schwarz ist es trotzdem.
		}
	}

	// Die Zurueck-Geste (Android) wuerde die Seite samt Sperre aushaengen --
	// in der Tasche reicht dafuer ein Wisch vom Rand.
	beforeNavigate((nav) => {
		if (locked && tracking) nav.cancel();
	});

	function unlock() {
		locked = false;
		if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
	}

	async function stop() {
		if (!confirm('Aufzeichnung beenden und speichern?')) return;
		try {
			await stopRun();
		} catch {
			// Steht in cardio.error; die Aufzeichnung bleibt zum erneuten Speichern.
		}
	}

	async function retry() {
		try {
			await saveRun();
		} catch {
			// Steht in cardio.error.
		}
	}

	function discard() {
		if (!confirm('Aufzeichnung verwerfen? Die Strecke wird nicht gespeichert.')) return;
		unlock();
		discardRun();
	}

	function gpsLabel(acc) {
		if (acc === null) return 'Suche GPS …';
		if (acc > MAX_ACCURACY) return `GPS ungenau (± ${acc} m) – warte …`;
		return `GPS ± ${acc} m`;
	}

	function timeOf(iso) {
		const d = new Date(iso);
		return Number.isNaN(d.getTime())
			? ''
			: d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
	}
</script>

<main class="flex flex-1 flex-col gap-4 px-3 py-4">
	<TrainingTabs />
	<EntryMode />

	<Card.Root>
		<Card.Header>
			<Card.Title>Cardio</Card.Title>
			<Card.Description>
				Strecke aufzeichnen. Das geht nur bei eingeschaltetem Bildschirm – sperr ihn mit dem
				Schloss, dann bleibt er schwarz an.
			</Card.Description>
		</Card.Header>

		<Card.Content class="flex flex-col gap-4">
			{#if !run}
				<div class="bg-muted grid grid-cols-3 gap-1 rounded-lg p-1" role="radiogroup" aria-label="Art">
					{#each KINDS as k (k.id)}
						<button
							type="button"
							role="radio"
							aria-checked={kind === k.id}
							class="flex h-11 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors {kind ===
							k.id
								? 'bg-background text-foreground shadow-sm'
								: 'text-muted-foreground hover:text-foreground'}"
							onclick={() => pickKind(k.id)}
						>
							{k.label}
						</button>
					{/each}
				</div>
				<Button size="lg" class="h-11 w-full" onclick={start}>
					<PlayIcon />
					{kindLabel(kind)} starten
				</Button>
			{:else}
				<div class="grid grid-cols-3 gap-2 text-center">
					<div class="flex flex-col">
						<span class="text-2xl font-semibold tabular-nums" role="timer">
							{formatDuration(elapsed)}
						</span>
						<span class="text-muted-foreground text-xs">Zeit</span>
					</div>
					<div class="flex flex-col">
						<span class="text-2xl font-semibold tabular-nums">{formatDistance(run.distance)}</span>
						<span class="text-muted-foreground text-xs">Strecke</span>
					</div>
					<div class="flex flex-col">
						<span class="text-2xl font-semibold tabular-nums">
							{formatPace(run.kind, run.distance, elapsed)}
						</span>
						<span class="text-muted-foreground text-xs">
							{run.kind === 'bike' ? 'Schnitt' : 'Pace'}
						</span>
					</div>
				</div>

				{#if tracking}
					<p class="text-muted-foreground text-center text-sm">
						{kindLabel(run.kind)} · {gpsLabel(cardio.accuracy)}
					</p>
				{/if}

				<CardioMap {points} version={cardio.version} live={tracking} />

				{#if cardio.awake === false && tracking}
					<Alert.Root>
						<InfoIcon />
						<Alert.Description>
							Dieses Gerät lässt den Bildschirm womöglich nicht an (Energiesparmodus?). Geht er
							aus, stoppt die Aufzeichnung – dann die automatische Sperre in den Einstellungen
							verlängern.
						</Alert.Description>
					</Alert.Root>
				{/if}

				{#if cardio.gap > 0 && tracking}
					<Alert.Root>
						<InfoIcon />
						<Alert.Description>
							Der Bildschirm war {formatDuration(cardio.gap)} aus. In der Zeit gab es keine
							Positionen – dazwischen zählt die Luftlinie.
						</Alert.Description>
						<Alert.Action>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Hinweis schließen"
								onclick={() => (cardio.gap = 0)}
							>
								<XIcon class="size-4" />
							</Button>
						</Alert.Action>
					</Alert.Root>
				{/if}

				{#if tracking}
					<div class="flex gap-2">
						<Button size="lg" class="h-11 flex-1" onclick={lock}>
							<LockIcon />
							Sperren
						</Button>
						<Button variant="outline" size="lg" class="h-11 flex-1" onclick={stop}>
							<SquareIcon />
							Beenden
						</Button>
						<Button
							variant="ghost"
							size="icon"
							class="text-muted-foreground size-11"
							onclick={discard}
							aria-label="Aufzeichnung verwerfen"
						>
							<XIcon class="size-5" />
						</Button>
					</div>
				{:else}
					<div class="flex gap-2">
						<Button size="lg" class="h-11 flex-1" disabled={cardio.saving} onclick={retry}>
							{cardio.saving ? 'Speichern …' : 'Erneut speichern'}
						</Button>
						<Button
							variant="outline"
							size="lg"
							class="h-11"
							disabled={cardio.saving}
							onclick={discard}
						>
							Verwerfen
						</Button>
					</div>
				{/if}
			{/if}

			{#if cardio.error}
				<Alert.Root variant="destructive">
					<AlertCircleIcon />
					<Alert.Description>{cardio.error}</Alert.Description>
				</Alert.Root>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Strecken</Card.Title>
		</Card.Header>
		<Card.Content>
			{#if cardio.loading}
				<p class="text-muted-foreground text-sm">Lade …</p>
			{:else if cardio.listError}
				<p class="text-destructive text-sm">{cardio.listError}</p>
			{:else if cardio.routes.length === 0}
				<p class="text-muted-foreground text-sm">Noch keine Strecke aufgezeichnet.</p>
			{:else}
				<ul class="divide-y rounded-lg border">
					{#each cardio.routes as r (r.id)}
						<li>
							<a href="/training/cardio/{r.id}" class="flex min-h-11 items-center gap-3 px-3 py-2">
								<div class="flex min-w-0 flex-1 flex-col">
									<span class="truncate text-sm font-medium">
										{kindLabel(r.kind)} · {formatDate(r.date)}
										<span class="text-muted-foreground font-normal">{timeOf(r.started)}</span>
									</span>
									<span class="text-muted-foreground text-xs tabular-nums">
										{formatDistance(r.distance)} · {formatDuration(r.duration ?? 0)} · {formatPace(
											r.kind,
											r.distance,
											r.duration
										)}
									</span>
								</div>
								<ChevronRightIcon class="text-muted-foreground size-4 shrink-0" />
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</Card.Content>
	</Card.Root>
</main>

{#if locked && tracking}
	<CardioLock
		time={formatDuration(elapsed)}
		distance={formatDistance(run.distance)}
		onunlock={unlock}
	/>
{/if}
