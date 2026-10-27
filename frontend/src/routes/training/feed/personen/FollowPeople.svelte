<script>
	import SearchIcon from '@lucide/svelte/icons/search';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import UserCheckIcon from '@lucide/svelte/icons/user-check';
	import { avatarUrl } from '$lib/pocketbase.svelte.js';
	import { follows, isFollowing, follow, unfollow, searchUsers } from '$lib/training-follows.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';

	// Personen folgen: Suche ueber alle Accounts mit eingeschaltetem Training
	// (app-weit), darunter die Liste, wem man schon folgt. Wer folgt, bekommt
	// eine Push-Meldung, sobald die Person ein Training veroeffentlicht.

	let query = $state('');
	let results = $state([]);
	let searching = $state(false);
	let searchError = $state('');
	let timer = null;
	let seq = 0; // Laufnummer: nur die juengste Suche darf das Ergebnis setzen

	function label(user) {
		return user?.name || 'Jemand';
	}

	// Beim Tippen mit kurzer Pause suchen; eine ueberholte Anfrage bricht das
	// SDK ueber den requestKey selbst ab -- die darf dann weder Ergebnis noch
	// "Suche ..." anfassen, das gehoert der juengsten.
	function onInput() {
		clearTimeout(timer);
		const q = query.trim();
		const mine = ++seq;
		if (!q) {
			results = [];
			searching = false;
			return;
		}
		searching = true;
		timer = setTimeout(async () => {
			try {
				const found = await searchUsers(q);
				if (mine !== seq) return;
				results = found;
				searchError = '';
			} catch (err) {
				if (mine !== seq || err?.isAbort) return;
				searchError = 'Suche fehlgeschlagen.';
			}
			searching = false;
		}, 250);
	}

	const followed = $derived(
		[...follows.list].sort((a, b) =>
			label(a.expand?.followed).localeCompare(label(b.expand?.followed), 'de')
		)
	);
</script>

<Card.Root class="gap-3 py-4">
	<Card.Header class="px-4">
		<Card.Title class="text-base">Personen, denen du folgst</Card.Title>
		<Card.Description>
			Du bekommst eine Mitteilung, wenn jemand, dem du folgst, ein Training veröffentlicht.
		</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-col gap-3 px-4">
		<label class="relative block">
			<span class="sr-only">Nach Namen suchen</span>
			<SearchIcon class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
			<Input
				type="search"
				placeholder="Nach Namen suchen …"
				autocomplete="off"
				class="h-11 pl-9"
				bind:value={query}
				oninput={onInput}
			/>
		</label>

		{#if follows.error}
			<p class="text-destructive text-sm">{follows.error}</p>
		{/if}

		{#if query.trim()}
			{#if searching && results.length === 0}
				<p class="text-muted-foreground text-sm">Suche …</p>
			{:else if searchError}
				<p class="text-destructive text-sm">{searchError}</p>
			{:else if results.length === 0}
				<p class="text-muted-foreground text-sm">Niemand mit Training gefunden.</p>
			{:else}
				<ul class="divide-y">
					{#each results as user (user.id)}
						{@const photo = avatarUrl(user, '100x100')}
						{@const following = isFollowing(user.id)}
						<li class="flex items-center gap-3 py-2">
							<Avatar.Root>
								{#if photo}<Avatar.Image src={photo} alt="" />{/if}
								<Avatar.Fallback>{label(user).charAt(0).toUpperCase()}</Avatar.Fallback>
							</Avatar.Root>
							<div class="min-w-0 flex-1">
								<p class="truncate">{label(user)}</p>
								{#if !user.training_public}
									<p class="text-muted-foreground text-xs">trainiert privat – noch keine Meldungen</p>
								{/if}
							</div>
							<Button
								variant={following ? 'default' : 'outline'}
								size="sm"
								class="h-9 touch-manipulation"
								aria-pressed={following}
								onclick={() => (following ? unfollow(user.id) : follow(user))}
							>
								{#if following}<UserCheckIcon />Folgst du{:else}<UserPlusIcon />Folgen{/if}
							</Button>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if follows.loading}
			<p class="text-muted-foreground text-sm">Lade …</p>
		{:else if followed.length === 0}
			<p class="text-muted-foreground text-sm">Du folgst noch niemandem.</p>
		{:else}
			<ul class="divide-y">
				{#each followed as f (f.id)}
					{@const user = f.expand?.followed}
					{@const photo = avatarUrl(user, '100x100')}
					<li class="flex items-center gap-3 py-2">
						<Avatar.Root>
							{#if photo}<Avatar.Image src={photo} alt="" />{/if}
							<Avatar.Fallback>{label(user).charAt(0).toUpperCase()}</Avatar.Fallback>
						</Avatar.Root>
						<p class="min-w-0 flex-1 truncate">{label(user)}</p>
						<Button
							variant="ghost"
							size="sm"
							class="h-9 touch-manipulation"
							onclick={() => unfollow(f.followed)}
						>
							Entfolgen
						</Button>
					</li>
				{/each}
			</ul>
		{/if}
	</Card.Content>
</Card.Root>
