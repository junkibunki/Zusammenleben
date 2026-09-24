<script>
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import { auth } from '$lib/pocketbase.svelte.js';
	import { households } from '$lib/households.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import {
		store,
		syncItems,
		addItem,
		toggleItem,
		deleteItem,
		clearDone,
		userLabel,
		formatWhen
	} from '$lib/items.svelte.js';
	import { categories, orderedCategories, NO_CATEGORY } from '$lib/categories.svelte.js';
	import { isCollapsed, toggleCategory, expandCategory } from '$lib/collapse.svelte.js';

	// "Anna · heute 19:41 · gekauft von Papa" -- leere Teile fallen raus.
	function metaFor(item) {
		const parts = [];
		const added = userLabel(item.expand?.added_by);
		const when = formatWhen(item.created);
		if (added) parts.push(added);
		if (when) parts.push(when);

		const buyer = userLabel(item.expand?.done_by);
		if (item.done && buyer) parts.push(`gekauft von ${buyer}`);

		return parts.join(' · ');
	}

	let draft = $state('');
	// ID der gewaehlten Kategorie. Kann leer sein oder auf eine inzwischen
	// geloeschte bzw. haushaltsfremde zeigen -- `chosen` normalisiert das an
	// *einer* Stelle auf die erste Kategorie.
	let category = $state('');
	let showDone = $state(false);

	// Laden + Realtime-Subscription; Teardown beim Verlassen der Seite.
	$effect(() => {
		const household = households.activeId;
		if (!auth.valid || !household) return;
		return syncItems(household);
	});

	const open = $derived(store.items.filter((i) => !i.done));
	const done = $derived(store.items.filter((i) => i.done));

	const ordered = $derived(orderedCategories());
	const chosen = $derived(ordered.find((c) => c.id === category) ?? ordered[0] ?? null);

	// In der Reihenfolge der Kategorien; was keine (mehr) hat, steht am Ende
	// unter "Ohne Kategorie" (Schluessel "").
	const groups = $derived.by(() => {
		const known = new Set(ordered.map((c) => c.id));
		const list = ordered.map((c) => ({
			key: c.id,
			label: c.name,
			items: open.filter((i) => i.category === c.id)
		}));
		list.push({ key: '', label: NO_CATEGORY, items: open.filter((i) => !known.has(i.category)) });
		return list.filter((g) => g.items.length > 0);
	});

	// Ohne Kategorien stuende alles kurz unter "Ohne Kategorie" und sprange dann.
	const loading = $derived(store.loading || (categories.loading && categories.list.length === 0));
	const error = $derived(store.error ?? categories.error);

	async function submit(e) {
		e.preventDefault();
		const name = draft;
		if (!name.trim()) return;
		draft = '';
		// Aufgeklappt werden muss genau die Gruppe, unter der der Eintrag dann steht.
		const target = chosen?.id ?? '';
		try {
			await addItem(name, target);
			// Sonst landet der neue Eintrag unsichtbar in einer zugeklappten Gruppe.
			expandCategory(target);
		} catch (err) {
			draft = name;
			store.error = err?.message ?? 'Hinzufügen fehlgeschlagen';
		}
	}
</script>

<form
	class="bg-background sticky top-(--header-h) z-10 flex items-center gap-2 border-b px-3 py-2.5"
	onsubmit={submit}
>
	<!-- Kein bind:value: das Select laesst sich abwaehlen (""), angezeigt und
	     benutzt wird immer `chosen`. -->
	<Select.Root
		type="single"
		value={chosen?.id ?? ''}
		onValueChange={(v) => (category = v)}
		disabled={ordered.length === 0}
	>
		<Select.Trigger class="h-11 w-32 shrink-0 data-[size=default]:h-11" aria-label="Wo einkaufen">
			<span class="truncate">{chosen?.name ?? NO_CATEGORY}</span>
		</Select.Trigger>
		<Select.Content>
			{#each ordered as c (c.id)}
				<Select.Item value={c.id} label={c.name}>{c.name}</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
	<Input
		type="text"
		bind:value={draft}
		placeholder="Was fehlt?"
		enterkeyhint="done"
		autocomplete="off"
		aria-label="Neuer Eintrag"
		class="h-11 flex-1"
	/>
</form>

{#if error}
	<div class="px-3 pt-3">
		<Alert.Root variant="destructive">
			<Alert.Description>{error}</Alert.Description>
			<Alert.Action>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Meldung schließen"
					onclick={() => {
						store.error = null;
						categories.error = null;
					}}
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
	{:else if store.items.length === 0}
		<p class="text-muted-foreground py-12 text-center text-sm">Die Liste ist leer. 🎉</p>
	{/if}

	{#snippet row(item)}
		{@const meta = metaFor(item)}
		<div class="flex items-center gap-3 pr-1 pl-3" class:opacity-60={item.done}>
			<Checkbox
				checked={item.done}
				onCheckedChange={() => toggleItem(item)}
				aria-label={item.name}
			/>
			<!-- Der Zeilentext unten liegt in einem aria-hidden-Bereich, ist also
			     nur fuer das Auge da. Ohne diese Kopie waere die Beschreibung per
			     Screenreader aus der Liste heraus gar nicht zu erreichen. Sie muss
			     ausserhalb des Buttons stehen -- aria-hidden erbt nach unten. -->
			{#if item.note}
				<span class="sr-only">Beschreibung: {item.note}</span>
			{/if}
			<!-- Die ganze Zeile soll antippbar bleiben; die Checkbox traegt den
			     zugaenglichen Namen, dieser Bereich ist nur der Trefferbereich.
			     Das senkrechte Padding sitzt hier drin, damit es mitzaehlt. -->
			<button
				type="button"
				class="min-w-0 flex-1 py-3 text-left"
				tabindex="-1"
				aria-hidden="true"
				onclick={() => toggleItem(item)}
			>
				<span class="block truncate" class:line-through={item.done}>
					{item.name}{#if item.quantity}<span class="text-muted-foreground">
							· {item.quantity}</span
						>{/if}
				</span>
				{#if item.note}
					<!-- line-clamp-2 setzt display:-webkit-box, deshalb kein "block";
					     whitespace-pre-line laesst eigene Zeilenumbrueche zaehlen. -->
					<span class="text-muted-foreground line-clamp-2 text-sm whitespace-pre-line"
						>{item.note}</span
					>
				{/if}
				{#if meta}
					<span class="text-muted-foreground block truncate text-xs">{meta}</span>
				{/if}
			</button>
			<Button
				variant="ghost"
				size="icon"
				class="text-muted-foreground size-11 shrink-0"
				aria-label="{item.name} bearbeiten"
				href="/items/{item.id}"
			>
				<PencilIcon class="size-4" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="text-muted-foreground hover:text-destructive size-11 shrink-0"
				aria-label="{item.name} löschen"
				onclick={() => deleteItem(item)}
			>
				<Trash2Icon class="size-4" />
			</Button>
		</div>
	{/snippet}

	{#each groups as group (group.key)}
		{@const collapsed = isCollapsed(group.key)}
		<section class="mb-4">
			<!-- Ueberschrift und Schalter in einem: die Zeile bleibt fuer Screenreader
			     eine Gliederungsebene, fuer den Daumen eine 44px hohe Flaeche. -->
			<h2>
				<button
					type="button"
					class="text-muted-foreground focus-visible:ring-ring/50 flex h-11 w-full items-center gap-1.5 rounded-md px-1 text-left text-xs font-medium tracking-wide uppercase outline-none focus-visible:ring-[3px]"
					aria-expanded={!collapsed}
					onclick={() => toggleCategory(group.key)}
				>
					{#if collapsed}
						<ChevronRightIcon class="size-4 shrink-0" />
					{:else}
						<ChevronDownIcon class="size-4 shrink-0" />
					{/if}
					<span class="truncate">{group.label}</span>
					<span class="shrink-0 normal-case">({group.items.length})</span>
				</button>
			</h2>
			{#if !collapsed}
				<div class="bg-card divide-y overflow-hidden rounded-lg border">
					{#each group.items as item (item.id)}
						{@render row(item)}
					{/each}
				</div>
			{/if}
		</section>
	{/each}

	{#if done.length > 0}
		<div class="mt-6 flex items-center gap-2">
			<Button
				variant="ghost"
				size="lg"
				class="text-muted-foreground h-11 flex-1 justify-start"
				onclick={() => (showDone = !showDone)}
			>
				{#if showDone}
					<ChevronDownIcon class="size-4" />
				{:else}
					<ChevronRightIcon class="size-4" />
				{/if}
				Erledigt ({done.length})
			</Button>
			<Button variant="destructive" size="lg" class="h-11" onclick={clearDone}>Aufräumen</Button>
		</div>

		{#if showDone}
			<div class="bg-card mt-2 divide-y overflow-hidden rounded-lg border">
				{#each done as item (item.id)}
					{@render row(item)}
				{/each}
			</div>
		{/if}
	{/if}
</main>
