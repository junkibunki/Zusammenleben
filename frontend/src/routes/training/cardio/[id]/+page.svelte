<script>
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { formatDate, formatDuration, trainingError } from '$lib/training.svelte.js';
	import {
		loadRoute,
		deleteRoute,
		kindLabel,
		formatDistance,
		formatPace
	} from '$lib/cardio.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import CardioMap from '../CardioMap.svelte';

	const id = $derived(page.params.id);

	// raw: tausende Punkte, die nur gelesen werden, brauchen keine Proxys.
	let route = $state.raw(null);
	let error = $state(null);
	let busy = $state(false);

	$effect(() => {
		const current = id;
		let cancelled = false;
		route = null;
		error = null;
		loadRoute(current)
			.then((r) => {
				if (!cancelled) route = r;
			})
			.catch((err) => {
				if (!cancelled) error = trainingError(err, 'Strecke konnte nicht geladen werden.');
			});
		return () => {
			cancelled = true;
		};
	});

	async function remove() {
		if (!route || busy) return;
		if (!confirm('Strecke löschen?')) return;
		busy = true;
		error = null;
		try {
			await deleteRoute(route.id);
			goto('/training/cardio');
		} catch (err) {
			error = trainingError(err, 'Löschen fehlgeschlagen.');
		} finally {
			busy = false;
		}
	}

	function timeOf(iso) {
		const d = new Date(iso);
		return Number.isNaN(d.getTime())
			? ''
			: d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
	}
</script>

<main class="flex flex-1 flex-col gap-4 px-3 py-4">
	<div>
		<Button href="/training/cardio" variant="ghost" class="-ml-2 h-11">
			<ArrowLeftIcon />
			Cardio
		</Button>
	</div>

	{#if error}
		<Alert.Root variant="destructive">
			<AlertCircleIcon />
			<Alert.Description>{error}</Alert.Description>
		</Alert.Root>
	{/if}

	{#if route}
		<Card.Root>
			<Card.Header>
				<Card.Title>{kindLabel(route.kind)} · {formatDate(route.date)}</Card.Title>
				<Card.Description>Start {timeOf(route.started)} Uhr</Card.Description>
				<Card.Action>
					<Button
						variant="ghost"
						size="icon"
						class="text-muted-foreground -mt-2 -mr-2 size-11"
						disabled={busy}
						onclick={remove}
						aria-label="Strecke löschen"
					>
						<Trash2Icon class="size-5" />
					</Button>
				</Card.Action>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<div class="grid grid-cols-3 gap-2 text-center">
					<div class="flex flex-col">
						<span class="text-xl font-semibold tabular-nums">
							{formatDuration(route.duration ?? 0)}
						</span>
						<span class="text-muted-foreground text-xs">Zeit</span>
					</div>
					<div class="flex flex-col">
						<span class="text-xl font-semibold tabular-nums">{formatDistance(route.distance)}</span>
						<span class="text-muted-foreground text-xs">Strecke</span>
					</div>
					<div class="flex flex-col">
						<span class="text-xl font-semibold tabular-nums">
							{formatPace(route.kind, route.distance, route.duration)}
						</span>
						<span class="text-muted-foreground text-xs">
							{route.kind === 'bike' ? 'Schnitt' : 'Pace'}
						</span>
					</div>
				</div>

				{#if Array.isArray(route.points) && route.points.length > 0}
					<CardioMap points={route.points} />
				{:else}
					<p class="text-muted-foreground text-sm">Keine Positionen aufgezeichnet.</p>
				{/if}
			</Card.Content>
		</Card.Root>
	{:else if !error}
		<p class="text-muted-foreground text-sm">Lade …</p>
	{/if}
</main>
