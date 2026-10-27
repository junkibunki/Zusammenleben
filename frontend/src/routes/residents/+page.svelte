<script>
	import XIcon from '@lucide/svelte/icons/x';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SearchIcon from '@lucide/svelte/icons/search';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { auth, avatarUrl } from '$lib/pocketbase.svelte.js';
	import {
		households,
		activeHousehold,
		listMembers,
		searchGuestCandidates,
		inviteGuest
	} from '$lib/households.svelte.js';
	import { userLabel, formatDate } from '$lib/items.svelte.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

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

	// Gast einladen: nur Haupt-Mitglieder. Gesucht wird unter allen Accounts
	// (pb_hooks/households-lib.js), gewaehlt wird eine Person, das Enddatum ist
	// optional.
	let inviteOpen = $state(false);
	let query = $state('');
	let results = $state([]);
	let searching = $state(false);
	let searchError = $state('');
	let picked = $state(null);
	let until = $state('');
	let inviting = $state(false);
	let inviteError = $state('');
	let timer = null;
	let seq = 0; // Laufnummer: nur die juengste Suche darf das Ergebnis setzen

	/** Heute als "YYYY-MM-DD" in der Zeit des Geraets -- frueheste Wahl fuers Enddatum. */
	function today() {
		const d = new Date();
		const pad = (n) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	}

	function openInvite() {
		clearTimeout(timer);
		seq++;
		query = '';
		results = [];
		searching = false;
		searchError = '';
		picked = null;
		until = '';
		inviteError = '';
		inviteOpen = true;
	}

	// Wie bei "Personen folgen": kurz warten, eine ueberholte Anfrage bricht das
	// SDK ueber den requestKey selbst ab.
	function onInput() {
		clearTimeout(timer);
		const q = query.trim();
		const householdId = households.activeId;
		const mine = ++seq;
		if (!q) {
			results = [];
			searching = false;
			return;
		}
		searching = true;
		timer = setTimeout(async () => {
			try {
				const found = await searchGuestCandidates(householdId, q);
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

	async function invite(event) {
		event.preventDefault();
		if (!picked || inviting) return;
		const householdId = households.activeId;
		inviting = true;
		inviteError = '';
		try {
			const member = await inviteGuest(householdId, picked.id, until);
			// Inzwischen den Haushalt gewechselt: dann gehoert der Gast nicht in
			// diese Liste, die laedt ohnehin neu.
			if (households.activeId === householdId && !users.some((u) => u.id === member.id)) {
				users.push(member);
			}
			inviteOpen = false;
		} catch (err) {
			const data = err?.response?.data;
			inviteError =
				data?.until?.message ||
				data?.user?.message ||
				(err?.status === 403
					? 'Nur Haupt-Mitglieder können Gäste einladen.'
					: 'Die Einladung hat nicht geklappt.');
		}
		inviting = false;
	}
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
		<ul class="surface divide-y">
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

	{#if !loading && !failed && household?.role === 'haupt'}
		<Button variant="outline" size="lg" class="mt-3 h-11 w-full" onclick={openInvite}>
			<UserPlusIcon class="size-4" />
			Gast einladen
		</Button>
	{/if}
</main>

<Sheet.Root bind:open={inviteOpen}>
	<Sheet.Content side="bottom" class="safe-b max-h-[85dvh] gap-0 overflow-y-auto">
		<Sheet.Header class="p-4 pr-12">
			<Sheet.Title>Gast einladen</Sheet.Title>
			<Sheet.Description>
				Gäste nutzen Zettel, Ausgaben und Wünsche von {household?.name ?? 'diesem Haushalt'} mit.
				Ohne Enddatum bleiben sie, bis jemand sie im Admin-Bereich austrägt.
			</Sheet.Description>
		</Sheet.Header>
		<form class="flex flex-col gap-4 px-4 pb-4" onsubmit={invite}>
			<label class="relative block">
				<span class="sr-only">Account suchen</span>
				<SearchIcon
					class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
				/>
				<Input
					type="search"
					placeholder="Name oder E-Mail …"
					autocomplete="off"
					class="h-11 pl-9"
					bind:value={query}
					oninput={onInput}
					onkeydown={(e) => e.key === 'Enter' && e.preventDefault()}
				/>
			</label>

			{#if query.trim()}
				{#if searching && results.length === 0}
					<p class="text-muted-foreground text-sm">Suche …</p>
				{:else if searchError}
					<p class="text-destructive text-sm">{searchError}</p>
				{:else if results.length === 0}
					<p class="text-muted-foreground text-sm">Niemand gefunden, der nicht schon dabei ist.</p>
				{:else}
					<ul class="divide-y rounded-lg border">
						{#each results as user (user.id)}
							{@const photo = avatarUrl(user)}
							{@const label = userLabel(user)}
							{@const selected = picked?.id === user.id}
							<li>
								<button
									type="button"
									class="hover:bg-muted flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left"
									aria-pressed={selected}
									onclick={() => (picked = user)}
								>
									<Avatar.Root>
										{#if photo}<Avatar.Image src={photo} alt="" />{/if}
										<Avatar.Fallback>{label.charAt(0).toUpperCase()}</Avatar.Fallback>
									</Avatar.Root>
									<span class="min-w-0 flex-1 truncate">{label}</span>
									{#if selected}<CheckIcon class="size-4 shrink-0" />{/if}
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}

			<div class="grid gap-1.5">
				<Label for="guest-until">Enddatum (optional)</Label>
				<Input id="guest-until" type="date" min={today()} bind:value={until} class="h-11 min-w-0" />
			</div>

			{#if inviteError}
				<p class="text-destructive text-sm">{inviteError}</p>
			{/if}

			<Button type="submit" size="lg" class="h-11" disabled={!picked || inviting}>
				{#if inviting}
					Lade ein …
				{:else if picked}
					{userLabel(picked)} einladen
				{:else}
					Person auswählen
				{/if}
			</Button>
		</form>
	</Sheet.Content>
</Sheet.Root>
