<script>
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import HandIcon from '@lucide/svelte/icons/hand';
	import TimerIcon from '@lucide/svelte/icons/timer';
	import DumbbellIcon from '@lucide/svelte/icons/dumbbell';
	import TrophyIcon from '@lucide/svelte/icons/trophy';
	import BikeIcon from '@lucide/svelte/icons/bike';
	import FootprintsIcon from '@lucide/svelte/icons/footprints';
	import LockIcon from '@lucide/svelte/icons/lock';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import UserCheckIcon from '@lucide/svelte/icons/user-check';
	import UsersIcon from '@lucide/svelte/icons/users';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { auth, avatarUrl } from '$lib/pocketbase.svelte.js';
	import { formatDuration } from '$lib/training.svelte.js';
	import { kindLabel, formatDistance, formatPace } from '$lib/cardio.svelte.js';
	import {
		feed,
		syncFeed,
		loadMore,
		hasKudos,
		toggleKudos,
		personLabel as label,
		feedDay as when,
		kudosNames as names
	} from '$lib/training-feed.svelte.js';
	import { follows, syncFollows, isFollowing, follow, unfollow } from '$lib/training-follows.svelte.js';
	import TrainingTabs from '../TrainingTabs.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';

	// Wer hat trainiert -- alle Nutzer der App, die ihre Trainings oeffentlich
	// machen (Profil), plus die eigenen. Lob heisst hier "Schulterklopfer".
	// Personen folgen (Push bei neuem Training): eigene Seite personen/ hinter
	// dem Icon oben, dazu der Knopf am Beitrag.

	const userId = $derived(auth.user?.id ?? '');
	const isPublic = $derived(Boolean(auth.user?.training_public));

	$effect(() => {
		if (userId) return syncFeed();
	});
	$effect(() => {
		if (userId) return syncFollows();
	});
</script>

<main class="flex flex-1 flex-col gap-4 px-3 py-4">
	<TrainingTabs />

	<div class="text-muted-foreground flex items-center gap-2 pl-1 text-sm">
		{#if isPublic}
			<GlobeIcon class="size-4 shrink-0" />
			<p class="min-w-0 flex-1">
				Deine Trainings sind öffentlich – alle in der App sehen sie hier.
				<a href="/profile" class="text-foreground underline underline-offset-2">Ändern</a>
			</p>
		{:else}
			<LockIcon class="size-4 shrink-0" />
			<p class="min-w-0 flex-1">
				Deine Trainings sind privat.
				<a href="/profile" class="text-foreground underline underline-offset-2">Im Profil</a>
				kannst du sie im Feed zeigen.
			</p>
		{/if}
		<Button
			href="/training/feed/personen"
			variant="ghost"
			size="icon"
			class="relative size-11 shrink-0"
			aria-label={follows.list.length
				? `Personen, denen du folgst (${follows.list.length})`
				: 'Personen folgen'}
		>
			<UsersIcon />
			{#if follows.list.length > 0}
				<span
					class="bg-primary text-primary-foreground absolute top-1 right-1 min-w-4 rounded-full px-1 text-[10px] leading-4 font-medium tabular-nums"
				>
					{follows.list.length}
				</span>
			{/if}
		</Button>
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
				{@const following = !own && isFollowing(post.user)}
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
							{#if !own}
								<Button
									variant="ghost"
									size="icon"
									class="size-11 shrink-0 touch-manipulation"
									aria-label={following ? `${label(author)} nicht mehr folgen` : `${label(author)} folgen`}
									aria-pressed={following}
									onclick={() => (following ? unfollow(post.user) : follow(author ?? { id: post.user }))}
								>
									{#if following}<UserCheckIcon class="text-primary" />{:else}<UserPlusIcon />{/if}
								</Button>
							{/if}
						</Card.Header>

						<Card.Content class="px-4">
							<svelte:element
								this={post.details?.length ? 'a' : 'div'}
								href={post.details?.length ? `/training/feed/${post.id}` : undefined}
								class="-mx-2 flex items-center gap-2 rounded-md px-2 py-1 {post.details?.length
									? 'hover:bg-muted/50 active:bg-muted transition-colors'
									: ''}"
							>
								<div class="flex min-w-0 flex-1 flex-col gap-2">
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
									{#if post.records?.length}
										<p class="flex items-start gap-1.5 text-sm">
											<TrophyIcon class="text-primary mt-0.5 size-4 shrink-0" />
											<span>
												Neuer Bestwert: <span class="font-medium">{post.records.join(', ')}</span>
											</span>
										</p>
									{/if}
								</div>
								{#if post.details?.length}
									<ChevronRightIcon class="text-muted-foreground size-5 shrink-0" />
								{/if}
							</svelte:element>
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
