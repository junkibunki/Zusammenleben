<script>
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import { auth, avatarUrl } from '$lib/pocketbase.svelte.js';
	import { households } from '$lib/households.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
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
	import { SvelteMap } from 'svelte/reactivity';
	import { slide } from 'svelte/transition';
	import { learn, memoryKey } from '$lib/memory.js';
	import { enter, leave, reducedMotion } from '$lib/motion.js';
	import { swipe } from '$lib/swipe.js';

	// Nach dem eigenen Abhaken bleibt die Zeile kurz in ihrer bisherigen Liste
	// stehen und wird dort durchgestrichen (bzw. der Strich verschwindet), erst
	// dann wechselt sie. Das muss *vor* dem Wechsel passieren: eine Zeile, die
	// gerade ausgeblendet wird, aktualisiert Svelte nicht mehr -- der Strich
	// kaeme dort nie an. id -> 'open' | 'done' = Liste, in der sie noch steht.
	const SETTLE_MS = 700;
	const settling = new SvelteMap();
	const timers = new Map();

	function toggle(item) {
		const from = item.done ? 'done' : 'open';
		toggleItem(item);
		if (reducedMotion()) return;
		clearTimeout(timers.get(item.id));
		if (settling.has(item.id)) {
			// Zurueckgetippt, bevor sie gewechselt hat: einfach stehen lassen.
			settling.delete(item.id);
			return;
		}
		settling.set(item.id, from);
		timers.set(
			item.id,
			setTimeout(() => {
				settling.delete(item.id);
				timers.delete(item.id);
			}, SETTLE_MS)
		);
	}

	const listOf = (item) => settling.get(item.id) ?? (item.done ? 'done' : 'open');

	// "(A) Anna · heute 19:41 · gekauft von (P) Papa" -- leere Teile fallen raus,
	// vor jedem Namen sitzt das Profilbild.
	function metaFor(item) {
		const addedBy = item.expand?.added_by;
		const doneBy = item.done ? item.expand?.done_by : null;
		return {
			addedBy,
			lead: [userLabel(addedBy), formatWhen(item.created)].filter(Boolean).join(' · '),
			doneBy,
			buyer: userLabel(doneBy)
		};
	}

	let draft = $state('');
	// ID der gewaehlten Kategorie. Kann leer sein oder auf eine inzwischen
	// geloeschte bzw. haushaltsfremde zeigen -- `chosen` normalisiert das an
	// *einer* Stelle auf die erste Kategorie.
	let category = $state('');
	// Von Hand gewaehlt: dann gilt der Chip, nicht die gemerkte Kategorie.
	let manual = $state(false);
	// name (klein) -> { name, category, count, last }, siehe memory.js.
	let memory = $state({});
	let showDone = $state(false);
	// Zeile, die nach links geschoben ihren Loeschen-Knopf zeigt -- hoechstens
	// eine. Loeschen gibt es nur so: kurz wischen und tippen, oder weit wischen.
	// Beim Loeschen bleibt openId bewusst stehen: ein settle(0) wuerde die
	// Zeile waehrend ihrer leave-Transition zurueck ueber den Knopf schieben.
	// Schlaegt das Loeschen fehl, kommt sie offen zurueck; sonst raeumt der
	// naechste Tipp auf.
	let openId = $state(null);
	// Ein Tipp irgendwo sonst schiebt die offene Zeile zu. Trifft er eine
	// andere Zeile, soll er nur das tun und sie nicht auch noch abhaken.
	let swallowClick = false;

	function closeOpen(e) {
		swallowClick = false;
		if (!openId || e.target.closest?.('[data-swipe-open]')) return;
		// Zeigt openId auf eine inzwischen geloeschte Zeile, gab es nichts zu
		// schliessen -- der Tipp gilt ganz normal.
		const wasOpen = store.items.some((i) => i.id === openId);
		openId = null;
		swallowClick = wasOpen && !!e.target.closest?.('[data-swipe-row]');
	}

	function swallow(e) {
		if (!swallowClick) return;
		swallowClick = false;
		e.stopPropagation();
		e.preventDefault();
	}

	// Laden + Realtime-Subscription; Teardown beim Verlassen der Seite.
	$effect(() => {
		const household = households.activeId;
		if (!auth.valid || !household) return;
		return syncItems(household);
	});

	// Was auf der Liste steht, ins Gedaechtnis. Liest `memory` nicht, schreibt
	// es nur -- sonst liefe der Effekt im Kreis. Muss *nach* dem syncItems-Effekt
	// stehen: der setzt beim Haushaltswechsel zuerst `store.loading`, sonst
	// lernte der neue Haushalt noch die Items des alten.
	$effect(() => {
		const household = households.activeId;
		if (!household || store.loading) return;
		memory = learn(
			household,
			store.items.map((i) => ({ name: i.name, category: i.category, created: i.created }))
		);
	});

	const open = $derived(store.items.filter((i) => listOf(i) === 'open'));
	const done = $derived(store.items.filter((i) => listOf(i) === 'done'));

	const ordered = $derived(orderedCategories());
	// Kennt das Gedaechtnis den getippten Artikel, springt der Chip auf dessen
	// Kategorie -- es sei denn, es wurde von Hand gewaehlt.
	const remembered = $derived(memory[memoryKey(draft)]?.category ?? '');
	const picked = $derived(
		!manual && ordered.some((c) => c.id === remembered) ? remembered : category
	);
	const chosen = $derived(ordered.find((c) => c.id === picked) ?? ordered[0] ?? null);

	// Bekannte Artikel, die zum Getippten passen und nicht schon offen auf der
	// Liste stehen: Wortanfang vor Treffer mittendrin, dann die haeufigsten.
	const suggestions = $derived.by(() => {
		const q = memoryKey(draft);
		if (!q) return [];
		const onList = new Set(open.map((i) => memoryKey(i.name)));
		return Object.entries(memory)
			.filter(([key]) => key !== q && key.includes(q) && !onList.has(key))
			.map(([key, entry]) => ({ key, ...entry, starts: key.startsWith(q) }))
			.sort((a, b) => b.starts - a.starts || b.count - a.count || b.last - a.last)
			.slice(0, 6);
	});

	function pick(id) {
		category = id;
		manual = true;
	}

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

	async function addSuggestion(s) {
		const known = !manual && ordered.some((c) => c.id === s.category);
		const target = known ? s.category : (chosen?.id ?? '');
		draft = '';
		category = target;
		manual = false;
		try {
			await addItem(s.name, target);
			expandCategory(target);
		} catch (err) {
			store.error = err?.message ?? 'Hinzufügen fehlgeschlagen';
		}
	}

	async function submit(e) {
		e.preventDefault();
		const name = draft;
		if (!name.trim()) return;
		// Aufgeklappt werden muss genau die Gruppe, unter der der Eintrag dann steht.
		const target = chosen?.id ?? '';
		draft = '';
		// Die naechste Eingabe startet in derselben Kategorie.
		category = target;
		manual = false;
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

<form class="bg-background sticky top-(--header-h) z-10 border-b" onsubmit={submit}>
	<div class="px-3 pt-2.5">
		<Input
			type="text"
			bind:value={draft}
			oninput={() => {
				if (!draft) manual = false;
			}}
			placeholder="Was fehlt?"
			enterkeyhint="done"
			autocomplete="off"
			aria-label="Neuer Eintrag"
			class="h-11"
		/>
	</div>

	<!-- Vorschlaege aus dem Gedaechtnis; ein Tipp traegt direkt ein. mousedown
	     verhindern, damit das Feld den Fokus (und das Handy die Tastatur) behaelt. -->
	{#if suggestions.length > 0}
		<div
			class="flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none]"
			role="group"
			aria-label="Vorschläge"
			transition:slide={{ duration: reducedMotion() ? 0 : 200 }}
		>
			{#each suggestions as s (s.key)}
				<button
					type="button"
					class="flex h-11 min-w-11 shrink-0 items-center justify-center"
					aria-label="{s.name} hinzufügen"
					onmousedown={(e) => e.preventDefault()}
					onclick={() => addSuggestion(s)}
				>
					<span
						class="bg-accent text-accent-foreground flex h-8 items-center gap-1 rounded-full px-3 text-sm motion-safe:transition-transform motion-safe:active:scale-95"
					>
						<PlusIcon class="size-3.5" aria-hidden="true" />
						{s.name}
					</span>
				</button>
			{/each}
		</div>
	{/if}

	<!-- Kategorie als Chips statt Dropdown: alle Optionen auf einen Blick, ein Tipp. -->
	{#if ordered.length > 0}
		<div
			class="flex gap-1.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none]"
			role="group"
			aria-label="Wo einkaufen"
		>
			{#each ordered as c (c.id)}
				{@const active = chosen?.id === c.id}
				<button
					type="button"
					class="flex h-11 min-w-11 shrink-0 items-center justify-center"
					aria-pressed={active}
					onmousedown={(e) => e.preventDefault()}
					onclick={() => pick(c.id)}
				>
					<span
						class={[
							'flex h-8 items-center rounded-full border px-3 text-sm motion-safe:transition-all motion-safe:duration-200 motion-safe:active:scale-95',
							active
								? 'bg-primary text-primary-foreground border-primary font-medium'
								: 'text-muted-foreground'
						]}
					>
						{c.name}
					</span>
				</button>
			{/each}
		</div>
	{/if}
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

<svelte:window onpointerdown={closeOpen} onclickcapture={swallow} />

<main class="flex-1 px-3 pt-3 pb-8">
	{#if loading}
		<p class="text-muted-foreground py-12 text-center text-sm">Lade …</p>
	{:else}
		{#if store.items.length === 0}
		<p class="text-muted-foreground py-12 text-center text-sm">Die Liste ist leer. 🎉</p>
		{/if}

		{#snippet face(user)}
			{@const photo = avatarUrl(user)}
			<Avatar.Root class="size-4 shrink-0">
				{#if photo}
					<Avatar.Image src={photo} alt="" />
				{/if}
				<Avatar.Fallback class="text-[0.5rem]">
					{(userLabel(user) || '?').charAt(0).toUpperCase()}
				</Avatar.Fallback>
			</Avatar.Root>
		{/snippet}

		{#snippet row(item)}
			{@const meta = metaFor(item)}
			<div class="relative" data-swipe-row data-swipe-open={openId === item.id ? '' : undefined}>
				<!-- Liegt hinter der Zeile und wird erst durch Wischen frei; bis dahin
				     fuer Tastatur und Screenreader unsichtbar. -->
				<div
					class="bg-destructive absolute inset-0 flex justify-end text-white"
					aria-hidden={openId !== item.id}
				>
					<button
						type="button"
						class="flex w-22 items-center justify-center active:bg-black/15"
						tabindex={openId === item.id ? 0 : -1}
						aria-label="{item.name} löschen"
						onclick={() => deleteItem(item)}
					>
						<Trash2Icon class="size-5 transition-transform [[data-far]_&]:scale-125" />
					</button>
				</div>
				<!-- Die Deckkraft sitzt eine Ebene tiefer: die geschobene Zeile selbst
				     muss deckend bleiben, sonst scheint der rote Knopf durch. -->
				<div
					class="bg-card relative touch-pan-y select-none"
					use:swipe={{
						open: openId === item.id,
						onopen: () => (openId = item.id),
						onclose: () => (openId = null),
						ondelete: () => deleteItem(item)
					}}
				>
					<div
						class="flex items-center gap-3 pr-1 pl-3 transition-opacity duration-300"
						class:opacity-60={item.done}
					>
						<Checkbox
							checked={item.done}
							onCheckedChange={() => toggle(item)}
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
							onclick={() => toggle(item)}
						>
							<span class="block truncate">
								<span class="strike" class:struck={item.done}
									>{item.name}{#if item.quantity}<span class="text-muted-foreground">
											· {item.quantity}</span
										>{/if}</span
								>
							</span>
							{#if item.note}
								<!-- line-clamp-2 setzt display:-webkit-box, deshalb kein "block";
								     whitespace-pre-line laesst eigene Zeilenumbrueche zaehlen. -->
								<span class="text-muted-foreground line-clamp-2 text-sm whitespace-pre-line"
									>{item.note}</span
								>
							{/if}
							{#if meta.lead || meta.buyer}
								<span class="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1 text-xs">
									{#if userLabel(meta.addedBy)}
										{@render face(meta.addedBy)}
									{/if}
									{#if meta.lead}
										<span class="truncate">{meta.lead}</span>
									{/if}
									{#if meta.buyer}
										<span class="shrink-0">{meta.lead ? '· ' : ''}gekauft von</span>
										{@render face(meta.doneBy)}
										<span class="truncate">{meta.buyer}</span>
									{/if}
								</span>
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
					</div>
				</div>
			</div>
		{/snippet}

		{#each groups as group (group.key)}
			{@const collapsed = isCollapsed(group.key)}
			<section
				class="mb-4"
				in:enter={{ glow: false }}
				out:leave
			>
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
					<div class="surface divide-y">
						{#each group.items as item (item.id)}
							<div in:enter out:leave>{@render row(item)}</div>
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
				<div class="surface mt-2 divide-y">
					{#each done as item (item.id)}
						<div in:enter out:leave>{@render row(item)}</div>
					{/each}
				</div>
			{/if}
		{/if}
	{/if}
</main>
