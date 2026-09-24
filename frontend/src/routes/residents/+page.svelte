<script>
	import XIcon from '@lucide/svelte/icons/x';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { auth, avatarUrl } from '$lib/pocketbase.svelte.js';
	import { households, activeHousehold, listMembers } from '$lib/households.svelte.js';
	import { userLabel, formatDate } from '$lib/items.svelte.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';

	let users = $state([]);
	let loading = $state(true);
	let failed = $state(false); // getrennt von `error`: die Meldung ist wegklickbar
	let error = $state('');
	let attempt = $state(0); // erhoeht der "Erneut laden"-Knopf, startet den Effekt neu

	// Laden beim Betreten der Seite. Der Effekt liest bewusst nichts von dem, was
	// sein eigener Rueckweg schreibt (`users`/`loading`/`error`/`failed`) --
	// sonst startet er sich selbst neu, siehe CLAUDE.md.
	$effect(() => {
		attempt;
		const household = households.activeId;
		// Ohne gueltiges Token nicht laden. Die Anzeige bleibt auf "Lade ..." --
		// der Guard im Layout leitet im selben Tick nach /login um, und "Keine
		// Accounts gefunden" waere fuer diesen Moment eine falsche Aussage.
		if (!auth.valid || !household) return;
		let cancelled = false;
		loading = true;
		failed = false;
		error = '';

		listMembers(household)
			.then((records) => {
				if (cancelled) return;
				// Abgelaufene Gaeste wohnen hier nicht mehr.
				users = records.filter((u) => u.membership.active);
				loading = false;
			})
			.catch(() => {
				if (cancelled) return;
				// PocketBase antwortet englisch und ohne Bezug zur Seite.
				error = 'Die Bewohner konnten nicht geladen werden.';
				failed = true;
				loading = false;
			});

		return () => (cancelled = true);
	});

	// Nach Anzeigenamen sortieren, nicht nach `name`: ein Account ohne Namen heisst
	// hier "Jemand" (die E-Mail liefert PocketBase in fremden Zeilen nicht mit) und
	// soll sich damit einreihen, statt als leerer Name vorneweg zu stehen.
	// Gaeste hinter die Bewohner.
	const sorted = $derived(
		[...users].sort(
			(a, b) =>
				(a.membership.role === 'gast') - (b.membership.role === 'gast') ||
				userLabel(a).localeCompare(userLabel(b), 'de')
		)
	);
	const household = $derived(activeHousehold());
</script>

{#if error}
	<div class="px-3 pt-3">
		<Alert.Root variant="destructive">
			<Alert.Description>{error}</Alert.Description>
			<Alert.Action>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Meldung schließen"
					onclick={() => (error = '')}
				>
					<XIcon class="size-4" />
				</Button>
			</Alert.Action>
		</Alert.Root>
	</div>
{/if}

<main class="flex-1 px-3 pt-3 pb-8">
	{#if loading}
		<p class="text-muted-foreground py-12 text-center text-sm">Lade …</p>
	{:else if failed}
		<div class="flex flex-col items-center gap-3 py-12">
			<p class="text-muted-foreground text-sm">Die Liste ist nicht angekommen.</p>
			<Button variant="outline" size="lg" class="h-11" onclick={() => attempt++}>
				<RefreshCwIcon class="size-4" />
				Erneut laden
			</Button>
		</div>
	{:else if sorted.length === 0}
		<p class="text-muted-foreground py-12 text-center text-sm">Keine Accounts gefunden.</p>
	{:else}
		<p class="text-muted-foreground mb-1.5 px-1 text-xs font-medium tracking-wide uppercase">
			{household?.name ?? ''} · {sorted.length}
			{sorted.length === 1 ? 'Person' : 'Personen'}
		</p>
		<ul class="bg-card divide-y overflow-hidden rounded-lg border">
			{#each sorted as user (user.id)}
				{@const photo = avatarUrl(user)}
				{@const label = userLabel(user)}
				{@const me = user.id === auth.user?.id}
				<li class="flex items-center gap-3 px-3 py-3">
					<Avatar.Root size="lg">
						{#if photo}
							<Avatar.Image src={photo} alt="" />
						{/if}
						<Avatar.Fallback>{(label || '?').charAt(0).toUpperCase()}</Avatar.Fallback>
					</Avatar.Root>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="truncate">{label}</span>
							{#if me}
								<Badge variant="secondary" class="shrink-0">du</Badge>
							{/if}
							{#if user.membership.role === 'gast'}
								<Badge variant="outline" class="shrink-0">Gast</Badge>
							{/if}
						</div>
						<!-- Bewusst fuer alle dasselbe: die E-Mail zeigt PocketBase nur beim
						     eigenen Record, in fremden Zeilen stuende sonst nichts. -->
						<span class="text-muted-foreground block truncate text-xs">
							{#if user.membership.role === 'gast'}
								{user.membership.until
									? `zu Gast bis ${formatDate(user.membership.until)}`
									: 'zu Gast'}
							{:else}
								dabei seit {formatDate(user.created)}
							{/if}
						</span>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</main>
