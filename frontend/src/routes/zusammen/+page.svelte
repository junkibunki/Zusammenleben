<script>
	import { goto } from '$app/navigation';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import Dice5Icon from '@lucide/svelte/icons/dice-5';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import UserCheckIcon from '@lucide/svelte/icons/user-check';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import XIcon from '@lucide/svelte/icons/x';
	import { auth, avatarUrl } from '$lib/pocketbase.svelte.js';
	import { households } from '$lib/households.svelte.js';
	import { userLabel } from '$lib/items.svelte.js';
	import {
		together,
		syncTogether,
		addEntry,
		toggleInterested,
		groupEntries,
		pickRandom,
		kindOf,
		isInterested,
		formatPlanned,
		KINDS,
		TITLE_MAX
	} from '$lib/together.svelte.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	// "Fuer alle" als eigener Wert: ein Single-Select von bits-ui setzt beim
	// erneuten Antippen "" (docs/pitfalls/designsystem.md) -- "" hiesse sonst
	// zufaellig auch "fuer alle".
	const ALL = 'all';

	let title = $state('');
	let kind = $state('');
	let visibility = $state(ALL);
	let posting = $state(false);

	// Filter: Art ("" = alle) und wessen Eintraege.
	let kindFilter = $state('');
	let scope = $state('all'); // all | mine | joined
	let showDone = $state(false);

	// Wuerfel
	let picked = $state(null);
	let pickOpen = $state(false);

	$effect(() => {
		if (!auth.valid) return;
		return syncTogether();
	});

	const me = $derived(auth.user?.id ?? '');

	const visible = $derived(
		together.items.filter(
			(e) =>
				(!kindFilter || e.kind === kindFilter) &&
				(scope === 'all' ||
					(scope === 'mine' && e.author === me) ||
					(scope === 'joined' && isInterested(e, me)))
		)
	);
	const groups = $derived(groupEntries(visible));

	const valid = $derived(title.trim().length > 0 && title.length <= TITLE_MAX && Boolean(kind));

	/** Name des Haushalts; leer = fuer alle. */
	function householdName(id) {
		if (!id) return '';
		return households.list.find((h) => h.id === id)?.name ?? 'Haushalt';
	}

	const visibilityLabel = $derived(visibility === ALL ? 'Für alle' : householdName(visibility));

	async function submit(e) {
		e.preventDefault();
		if (!valid || posting) return;
		posting = true;
		try {
			await addEntry({
				title,
				kind,
				household: visibility === ALL ? '' : visibility
			});
			title = '';
		} catch (err) {
			together.error = err?.message ?? 'Speichern fehlgeschlagen';
		} finally {
			posting = false;
		}
	}

	function roll() {
		picked = pickRandom(together.items, me, kindFilter);
		pickOpen = true;
	}

	/** "Café & Essen · Zuhause" -- Art und, falls nicht fuer alle, der Haushalt. */
	function metaFor(entry) {
		const parts = [kindOf(entry.kind).label];
		const where = householdName(entry.household);
		if (where) parts.push(where);
		return parts.join(' · ');
	}
</script>

{#snippet row(entry)}
	{@const k = kindOf(entry.kind)}
	{@const joined = isInterested(entry, me)}
	{@const people = entry.expand?.interested ?? []}
	{@const count = entry.interested?.length ?? 0}
	<li class="flex items-center gap-3 py-2 pr-1 pl-3" class:opacity-60={Boolean(entry.done_at)}>
		<a href={`/zusammen/${entry.id}`} class="flex min-w-0 flex-1 items-center gap-3 py-1">
			<span class="text-2xl leading-none" aria-hidden="true">{k.emoji}</span>
			<span class="min-w-0 flex-1">
				<span class="block truncate font-medium">{entry.title}</span>
				<span class="text-muted-foreground block truncate text-xs">
					{#if entry.planned_at && !entry.done_at}
						<CalendarIcon class="mb-0.5 inline size-3" />
						{formatPlanned(entry.planned_at)} ·
					{/if}
					{metaFor(entry)}
				</span>
			</span>
			{#if count > 0}
				<span class="flex shrink-0 -space-x-2" aria-label={`${count} dabei`}>
					{#each people.slice(0, 3) as user (user.id)}
						{@const photo = avatarUrl(user)}
						<Avatar.Root class="ring-background size-6 ring-2">
							{#if photo}
								<Avatar.Image src={photo} alt="" />
							{/if}
							<Avatar.Fallback class="text-[10px]">
								{(userLabel(user) || '?').charAt(0).toUpperCase()}
							</Avatar.Fallback>
						</Avatar.Root>
					{/each}
					{#if count > 3}
						<span
							class="bg-muted ring-background flex size-6 items-center justify-center rounded-full text-[10px] ring-2"
						>
							+{count - 3}
						</span>
					{/if}
				</span>
			{/if}
		</a>
		{#if !entry.done_at}
			<Button
				variant="ghost"
				size="icon"
				class={['size-11 shrink-0', joined ? 'text-primary' : 'text-muted-foreground']}
				aria-pressed={joined}
				aria-label={`„${entry.title}“: ${joined ? 'doch nicht dabei' : 'bin dabei'}`}
				onclick={() => toggleInterested(entry)}
			>
				{#if joined}
					<UserCheckIcon class="size-4" />
				{:else}
					<UserPlusIcon class="size-4" />
				{/if}
			</Button>
		{/if}
	</li>
{/snippet}

<form class="bg-background flex flex-col gap-2 border-b px-3 py-2.5" onsubmit={submit}>
	<div class="flex gap-2">
		<Input
			bind:value={title}
			maxlength={TITLE_MAX}
			autocomplete="off"
			aria-label="Was wollen wir machen?"
			placeholder="Was müssen wir mal machen?"
			class="h-11 flex-1"
		/>
		<Button
			type="submit"
			size="icon"
			class="size-11 shrink-0"
			disabled={!valid || posting}
			aria-label="Hinzufügen"
		>
			<PlusIcon class="size-5" />
		</Button>
	</div>
	<div class="grid grid-cols-2 gap-2">
		<Select.Root type="single" bind:value={kind}>
			<Select.Trigger class="h-11 w-full data-[size=default]:h-11" aria-label="Art">
				{kind ? `${kindOf(kind).emoji} ${kindOf(kind).label}` : 'Was für etwas?'}
			</Select.Trigger>
			<Select.Content>
				{#each KINDS as k (k.id)}
					<Select.Item value={k.id} label={k.label}>{k.emoji} {k.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		<Select.Root
			type="single"
			bind:value={() => visibility, (v) => (visibility = v || ALL)}
		>
			<Select.Trigger class="h-11 w-full data-[size=default]:h-11" aria-label="Wer sieht das?">
				{visibilityLabel}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value={ALL} label="Für alle">Für alle</Select.Item>
				{#each households.list as h (h.id)}
					<Select.Item value={h.id} label={h.name}>Nur {h.name}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>
</form>

<div class="flex flex-col gap-2 px-3 pt-3">
	<div class="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1">
		<Button
			variant={kindFilter === '' ? 'default' : 'outline'}
			size="sm"
			class="h-9 shrink-0 rounded-full"
			onclick={() => (kindFilter = '')}
		>
			Alle
		</Button>
		{#each KINDS as k (k.id)}
			<Button
				variant={kindFilter === k.id ? 'default' : 'outline'}
				size="sm"
				class="h-9 shrink-0 rounded-full"
				onclick={() => (kindFilter = kindFilter === k.id ? '' : k.id)}
			>
				{k.emoji} {k.label}
			</Button>
		{/each}
	</div>

	<div class="flex items-center gap-2">
		<div class="bg-muted flex flex-1 rounded-lg p-0.5 text-sm">
			{#each [['all', 'Alle'], ['joined', 'Bin dabei'], ['mine', 'Von mir']] as [value, label] (value)}
				<button
					type="button"
					class={[
						'h-10 flex-1 rounded-md',
						scope === value ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'
					]}
					aria-pressed={scope === value}
					onclick={() => (scope = value)}
				>
					{label}
				</button>
			{/each}
		</div>
		<Button
			variant="outline"
			size="icon"
			class="size-11 shrink-0"
			aria-label="Was machen wir? Zufallsvorschlag"
			onclick={roll}
		>
			<Dice5Icon class="size-5" />
		</Button>
	</div>
</div>

{#if together.error}
	<div class="px-3 pt-3">
		<Alert.Root variant="destructive">
			<Alert.Description>{together.error}</Alert.Description>
			<Alert.Action>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Meldung schließen"
					onclick={() => (together.error = null)}
				>
					<XIcon class="size-4" />
				</Button>
			</Alert.Action>
		</Alert.Root>
	</div>
{/if}

<main class="flex flex-1 flex-col gap-5 px-3 pt-4 pb-8">
	{#if together.loading}
		<p class="text-muted-foreground py-12 text-center text-sm">Lade …</p>
	{:else if visible.length === 0}
		<p class="text-muted-foreground py-12 text-center text-sm">
			{together.items.length === 0
				? 'Noch nichts vorgemerkt. Café, Wanderung, Film? 🎉'
				: 'Hier passt gerade nichts zum Filter.'}
		</p>
	{:else}
		{#if groups.planned.length > 0}
			<section>
				<h2 class="text-muted-foreground mb-1.5 px-1 text-xs font-medium uppercase">Geplant</h2>
				<ul class="surface divide-y">
					{#each groups.planned as entry (entry.id)}
						{@render row(entry)}
					{/each}
				</ul>
			</section>
		{/if}

		{#if groups.open.length > 0}
			<section>
				<h2 class="text-muted-foreground mb-1.5 px-1 text-xs font-medium uppercase">
					Müssen wir mal machen
				</h2>
				<ul class="surface divide-y">
					{#each groups.open as entry (entry.id)}
						{@render row(entry)}
					{/each}
				</ul>
			</section>
		{/if}

		{#if groups.done.length > 0}
			<section>
				<Button
					variant="ghost"
					class="text-muted-foreground -ml-2 h-11"
					aria-expanded={showDone}
					onclick={() => (showDone = !showDone)}
				>
					{showDone ? 'Gemacht ausblenden' : `Gemacht anzeigen (${groups.done.length})`}
				</Button>
				{#if showDone}
					<ul class="surface mt-1.5 divide-y">
						{#each groups.done as entry (entry.id)}
							{@render row(entry)}
						{/each}
					</ul>
				{/if}
			</section>
		{/if}
	{/if}
</main>

<AlertDialog.Root bind:open={pickOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Wie wär's mit …</AlertDialog.Title>
			{#if !picked}
				<AlertDialog.Description>
					Nichts Offenes{kindFilter ? ` bei ${kindOf(kindFilter).label}` : ''}. Trag was ein!
				</AlertDialog.Description>
			{/if}
		</AlertDialog.Header>

		{#if picked}
			<p class="flex items-center gap-3 text-lg font-medium">
				<span class="text-3xl" aria-hidden="true">{kindOf(picked.kind).emoji}</span>
				{picked.title}
			</p>
		{/if}

		<AlertDialog.Footer>
			<AlertDialog.Cancel class="h-11">Schließen</AlertDialog.Cancel>
			{#if picked}
				<AlertDialog.Action variant="outline" class="h-11" onclick={roll}>
					Nochmal
				</AlertDialog.Action>
				<AlertDialog.Action
					class="h-11"
					onclick={() => {
						pickOpen = false;
						goto(`/zusammen/${picked.id}`);
					}}
				>
					Ansehen
				</AlertDialog.Action>
			{/if}
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
