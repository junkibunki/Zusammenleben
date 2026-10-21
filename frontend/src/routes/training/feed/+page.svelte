<script>
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import HandIcon from '@lucide/svelte/icons/hand';
	import TimerIcon from '@lucide/svelte/icons/timer';
	import DumbbellIcon from '@lucide/svelte/icons/dumbbell';
	import TrophyIcon from '@lucide/svelte/icons/trophy';
	import LockIcon from '@lucide/svelte/icons/lock';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import { auth, avatarUrl } from '$lib/pocketbase.svelte.js';
	import { formatDate, formatDuration, today } from '$lib/training.svelte.js';
	import { feed, syncFeed, loadMore, hasKudos, toggleKudos } from '$lib/training-feed.svelte.js';
	import TrainingTabs from '../TrainingTabs.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';

	// Wer hat trainiert -- alle Nutzer der App, die ihre Trainings oeffentlich
	// machen (Profil), plus die eigenen. Lob heisst hier "Schulterklopfer".

	const userId = $derived(auth.user?.id ?? '');
	const isPublic = $derived(Boolean(auth.user?.training_public));

	$effect(() => {
		if (userId) return syncFeed();
	});

	function label(user) {
		return user?.name || user?.email?.split('@')[0] || 'Jemand';
	}

	/** "heute", "gestern" oder "Fr, 02.10." */
	function when(date) {
		const t = today();
		if (date === t) return 'heute';
		const [y, m, d] = t.split('-').map(Number);
		const y2 = new Date(y, m - 1, d - 1);
		const pad = (n) => String(n).padStart(2, '0');
		if (date === `${y2.getFullYear()}-${pad(y2.getMonth() + 1)}-${pad(y2.getDate())}`) return 'gestern';
		return formatDate(date);
	}

	/** "Anna", "Anna und Ben", "Anna, Ben und 3 weitere" */
	function names(users) {
		const list = (users ?? []).map(label);
		if (list.length <= 1) return list.join('');
		if (list.length === 2) return `${list[0]} und ${list[1]}`;
		if (list.length === 3) return `${list[0]}, ${list[1]} und ${list[2]}`;
		return `${list[0]}, ${list[1]} und ${list.length - 2} weitere`;
	}
</script>

<main class="flex flex-1 flex-col gap-4 px-3 py-4">
	<TrainingTabs />

	<div class="text-muted-foreground flex items-start gap-2 px-1 text-sm">
		{#if isPublic}
			<GlobeIcon class="mt-0.5 size-4 shrink-0" />
			<p>
				Deine Trainings sind öffentlich – alle in der App sehen sie hier.
				<a href="/profile" class="text-foreground underline underline-offset-2">Ändern</a>
			</p>
		{:else}
			<LockIcon class="mt-0.5 size-4 shrink-0" />
			<p>
				Deine Trainings sind privat.
				<a href="/profile" class="text-foreground underline underline-offset-2">Im Profil</a>
				kannst du sie im Feed zeigen.
			</p>
		{/if}
	</div>

	{#if feed.error}
		<Alert.Root variant="destructive">
			<AlertCircleIcon />
			<Alert.Description>{feed.error}</Alert.Description>
		</Alert.Root>
	{/if}

	{#if feed.loading}
		<p class="text-muted-foreground px-1 text-sm">Lade …</p>
	{:else if feed.posts.length === 0}
		<Card.Root>
			<Card.Content class="text-muted-foreground text-sm">
				Noch hat niemand ein Training geteilt.
			</Card.Content>
		</Card.Root>
	{:else}
		<ul class="flex flex-col gap-3">
			{#each feed.posts as post (post.id)}
				{@const author = post.expand?.user}
				{@const own = post.user === userId}
				{@const klopft = hasKudos(post, userId)}
				{@const count = post.kudos?.length ?? 0}
				{@const photo = avatarUrl(author, '100x100')}
				<li>
					<Card.Root class="gap-3 py-4">
						<Card.Header class="flex items-center gap-3 px-4">
							<Avatar.Root>
								{#if photo}<Avatar.Image src={photo} alt="" />{/if}
								<Avatar.Fallback>{label(author).charAt(0).toUpperCase()}</Avatar.Fallback>
							</Avatar.Root>
							<div class="min-w-0 flex-1">
								<p class="truncate font-medium">
									{own ? 'Du' : label(author)}
									<span class="text-muted-foreground font-normal">
										{own ? 'hast' : 'hat'} trainiert
									</span>
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
							{#if post.records?.length}
								<p class="flex items-start gap-1.5 text-sm">
									<TrophyIcon class="text-primary mt-0.5 size-4 shrink-0" />
									<span>
										Neuer Bestwert: <span class="font-medium">{post.records.join(', ')}</span>
									</span>
								</p>
							{/if}
						</Card.Content>

						<Card.Footer class="flex items-center gap-3 px-4">
							{#if own}
								<p class="text-muted-foreground flex items-center gap-1.5 text-sm">
									<HandIcon class="size-4" />
									{count === 0
										? 'Noch kein Schulterklopfer'
										: `${count} ${count === 1 ? 'Schulterklopfer' : 'Schulterklopfer'}`}
								</p>
							{:else}
								<Button
									variant={klopft ? 'default' : 'outline'}
									class="h-11 touch-manipulation"
									aria-pressed={klopft}
									onclick={() => toggleKudos(post)}
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
				</li>
			{/each}
		</ul>

		{#if feed.hasMore}
			<Button variant="outline" class="h-11" disabled={feed.loadingMore} onclick={loadMore}>
				{feed.loadingMore ? 'Lade …' : 'Ältere Trainings'}
			</Button>
		{/if}
	{/if}
</main>
