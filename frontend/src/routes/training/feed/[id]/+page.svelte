<script>
	import { page } from '$app/state';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import HandIcon from '@lucide/svelte/icons/hand';
	import TimerIcon from '@lucide/svelte/icons/timer';
	import DumbbellIcon from '@lucide/svelte/icons/dumbbell';
	import TrophyIcon from '@lucide/svelte/icons/trophy';
	import BikeIcon from '@lucide/svelte/icons/bike';
	import FootprintsIcon from '@lucide/svelte/icons/footprints';
	import { auth, avatarUrl } from '$lib/pocketbase.svelte.js';
	import { formatDuration, formatWeight } from '$lib/training.svelte.js';
	import { kindLabel, formatDistance, formatPace } from '$lib/cardio.svelte.js';
	import {
		feed,
		watchPost,
		hasKudos,
		toggleKudos,
		personLabel as label,
		feedDay as when,
		kudosNames as names
	} from '$lib/training-feed.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';

	// Ein Beitrag aus dem Feed komplett: jede Uebung mit allen Saetzen und
	// Gewichten (`details`, Migration 1790600400). Der Server schreibt sie mit
	// dem Beitrag; die Trainingsdaten selbst bleiben privat.

	const userId = $derived(auth.user?.id ?? '');
	const postId = $derived(page.params.id ?? '');

	let post = $state(null);
	let loading = $state(true);
	let error = $state(null);

	// Liest nur userId/postId, schreibt nur die drei Felder oben.
	$effect(() => {
		const id = postId;
		if (!userId || !id) return;
		loading = true;
		error = null;
		return watchPost(
			id,
			(record) => {
				post = record;
				loading = false;
			},
			(message) => {
				error = message;
				loading = false;
			}
		);
	});

	const author = $derived(post?.expand?.user);
	const own = $derived(post?.user === userId);
	const klopft = $derived(post ? hasKudos(post, userId) : false);
	const count = $derived(post?.kudos?.length ?? 0);
	const photo = $derived(avatarUrl(author, '100x100'));
	const details = $derived(Array.isArray(post?.details) ? post.details : []);
	const records = $derived(new Set(post?.records ?? []));

	// toggleKudos meldet Fehler in feed.error -- hier herholen, sonst springt
	// der Knopf kommentarlos zurueck.
	async function klopfen() {
		feed.error = null;
		await toggleKudos(post);
		if (feed.error) error = feed.error;
	}

	const n = (v) => Number(v).toLocaleString('de-DE', { maximumFractionDigits: 2 });

	/** Ein Satz: "60 kg × 8 Wdh.", "12 Wdh. · +10 kg", "45 s" */
	function setLabel(kind, s) {
		if (kind === 'time') return s.seconds != null ? `${s.seconds} s` : '–';
		const reps = s.reps != null ? `${s.reps} Wdh.` : '';
		if (kind === 'bodyweight') {
			return s.weight > 0 ? `${reps || '–'} · +${n(s.weight)} kg` : reps || '–';
		}
		if (s.weight == null) return reps || '–';
		return reps ? `${formatWeight(s.weight)} × ${reps}` : formatWeight(s.weight);
	}

	/** Nummer des Satzes ohne Aufwaermsaetze; Aufwaermen bekommt ein "A". */
	function numbered(sets) {
		let i = 0;
		return sets.map((s) => ({ ...s, no: s.warmup ? 'A' : String(++i) }));
	}
</script>

<main class="flex flex-1 flex-col gap-4 px-3 py-4">
	<div>
		<Button href="/training/feed" variant="ghost" class="text-muted-foreground -ml-2 h-11">
			<ArrowLeftIcon class="size-4" />
			Zurück zum Feed
		</Button>
	</div>

	{#if error}
		<Alert.Root variant="destructive">
			<AlertCircleIcon />
			<Alert.Description>{error}</Alert.Description>
		</Alert.Root>
	{/if}

	{#if loading}
		<p class="text-muted-foreground px-1 text-sm">Lade …</p>
	{:else if !post}
		{#if !error}
			<Card.Root>
				<Card.Header>
					<Card.Title>Training nicht gefunden</Card.Title>
					<Card.Description>
						Dieses Training gibt es nicht (mehr), oder es ist nicht mehr öffentlich.
					</Card.Description>
				</Card.Header>
			</Card.Root>
		{/if}
	{:else}
		<Card.Root class="gap-3 py-4">
			<Card.Header class="flex items-center gap-3 px-4">
				<Avatar.Root>
					{#if photo}<Avatar.Image src={photo} alt="" />{/if}
					<Avatar.Fallback>{label(author).charAt(0).toUpperCase()}</Avatar.Fallback>
				</Avatar.Root>
				<div class="min-w-0 flex-1">
					<p class="truncate font-medium">
						{own ? 'Du' : label(author)}
						<span class="text-muted-foreground font-normal">{own ? 'hast' : 'hat'} trainiert</span>
					</p>
					<p class="text-muted-foreground text-xs">{when(post.date)}</p>
				</div>
			</Card.Header>

			<Card.Content class="flex flex-col gap-2 px-4">
				{#if post.workout}
					<p class="text-lg leading-tight font-semibold">{post.workout}</p>
				{/if}
				<p class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
					{#if post.duration > 0}
						<span class="inline-flex items-center gap-1">
							<TimerIcon class="size-4" />
							<span class="tabular-nums">{formatDuration(post.duration)}</span>
						</span>
					{/if}
					{#if post.exercises > 0}
						<span>{post.exercises} {post.exercises === 1 ? 'Übung' : 'Übungen'}</span>
						<span>{post.sets} {post.sets === 1 ? 'Satz' : 'Sätze'}</span>
					{/if}
					{#if post.volume > 0}
						<span class="inline-flex items-center gap-1">
							<DumbbellIcon class="size-4" />
							<span class="tabular-nums">{post.volume.toLocaleString('de-DE')} kg</span>
							Volumen
						</span>
					{/if}
				</p>
				{#if Array.isArray(post.cardio)}
					{#each post.cardio as c, i (i)}
						<p class="flex items-center gap-1.5 text-sm">
							{#if c.kind === 'bike'}
								<BikeIcon class="text-primary size-4 shrink-0" />
							{:else}
								<FootprintsIcon class="text-primary size-4 shrink-0" />
							{/if}
							<span class="font-medium">{kindLabel(c.kind)}</span>
							<span class="text-muted-foreground tabular-nums">
								{formatDistance(c.distance)} · {formatDuration(c.duration ?? 0)} · {formatPace(
									c.kind,
									c.distance,
									c.duration
								)}
							</span>
						</p>
					{/each}
				{/if}
			</Card.Content>

			<Card.Footer class="flex items-center gap-3 px-4">
				{#if own}
					<p class="text-muted-foreground flex items-center gap-1.5 text-sm">
						<HandIcon class="size-4" />
						{count === 0 ? 'Noch kein Schulterklopfer' : `${count} Schulterklopfer`}
					</p>
				{:else}
					<Button
						variant={klopft ? 'default' : 'outline'}
						class="h-11 touch-manipulation"
						aria-pressed={klopft}
						onclick={klopfen}
					>
						<HandIcon />
						{klopft ? 'Geklopft' : 'Schulter klopfen'}
						{#if count > 0}<span class="tabular-nums opacity-80">· {count}</span>{/if}
					</Button>
				{/if}
				{#if count > 0}
					<p class="text-muted-foreground min-w-0 flex-1 truncate text-xs">
						{own ? 'von ' : ''}{names(post.expand?.kudos)}
					</p>
				{/if}
			</Card.Footer>
		</Card.Root>

		{#if details.length === 0}
			<p class="text-muted-foreground px-1 text-sm">Zu diesem Training gibt es keine Sätze.</p>
		{:else}
			<ul class="flex flex-col gap-3">
				{#each details as d, i (i)}
					<li>
						<Card.Root class="gap-2 py-4">
							<Card.Header class="px-4">
								<Card.Title class="flex items-start gap-1.5">
									<span class="min-w-0 flex-1">{d.name}</span>
									{#if records.has(d.name)}
										<span class="text-primary inline-flex shrink-0 items-center gap-1 text-xs font-medium">
											<TrophyIcon class="size-4" />
											Bestwert
										</span>
									{/if}
								</Card.Title>
							</Card.Header>
							<Card.Content class="px-4">
								<ol class="flex flex-col">
									{#each numbered(d.sets ?? []) as s, j (j)}
										<li
											class="flex items-center gap-3 border-b py-1.5 text-sm last:border-b-0 {s.warmup
												? 'text-muted-foreground'
												: ''}"
										>
											<span
												class="text-muted-foreground w-5 text-right text-xs tabular-nums"
												aria-label={s.warmup ? 'Aufwärmsatz' : `Satz ${s.no}`}
											>
												{s.no}
											</span>
											<span class="tabular-nums">{setLabel(d.kind, s)}</span>
										</li>
									{/each}
								</ol>
							</Card.Content>
						</Card.Root>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</main>
