<script>
	import { auth } from '$lib/pocketbase.svelte.js';
	import {
		store,
		syncItems,
		addItem,
		toggleItem,
		deleteItem,
		clearDone,
		userLabel,
		formatWhen,
		CATEGORIES,
		DEFAULT_CATEGORY
	} from '$lib/items.svelte.js';

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
	let category = $state(DEFAULT_CATEGORY);
	let showDone = $state(false);

	// Laden + Realtime-Subscription; Teardown beim Verlassen der Seite.
	$effect(() => {
		if (!auth.valid) return;
		return syncItems();
	});

	const open = $derived(store.items.filter((i) => !i.done));
	const done = $derived(store.items.filter((i) => i.done));

	const groups = $derived(
		CATEGORIES.map((c) => ({
			category: c,
			items: open.filter((i) => (i.category || DEFAULT_CATEGORY) === c)
		})).filter((g) => g.items.length > 0)
	);

	async function submit(e) {
		e.preventDefault();
		const name = draft;
		if (!name.trim()) return;
		draft = '';
		try {
			await addItem(name, category);
		} catch (err) {
			draft = name;
			store.error = err?.message ?? 'Hinzufügen fehlgeschlagen';
		}
	}
</script>

<form class="add" onsubmit={submit}>
	<input
		type="text"
		bind:value={draft}
		placeholder="Was fehlt?"
		enterkeyhint="done"
		autocomplete="off"
		aria-label="Neuer Eintrag"
	/>
	<select bind:value={category} aria-label="Kategorie">
		{#each CATEGORIES as c (c)}
			<option value={c}>{c}</option>
		{/each}
	</select>
</form>

{#if store.error}
	<button class="error" style="width:calc(100% - 24px)" onclick={() => (store.error = null)}>
		{store.error} (tippen zum Ausblenden)
	</button>
{/if}

<main class="list">
	{#if store.loading}
		<p class="loading">Lade …</p>
	{:else if store.items.length === 0}
		<p class="empty">Die Liste ist leer. 🎉</p>
	{/if}

	{#each groups as group (group.category)}
		<section class="group">
			<h2>{group.category}</h2>
			{#each group.items as item (item.id)}
				{@const meta = metaFor(item)}
				<div class="row">
					<button class="main" onclick={() => toggleItem(item)}>
						<span class="box"></span>
						<span class="label">
							<span>{item.name}</span>
							{#if item.quantity}<span class="qty"> · {item.quantity}</span>{/if}
							{#if item.note}<br /><span class="qty">{item.note}</span>{/if}
							{#if meta}<span class="meta">{meta}</span>{/if}
						</span>
					</button>
					<button class="del" aria-label="Löschen" onclick={() => deleteItem(item)}>×</button>
				</div>
			{/each}
		</section>
	{/each}

	{#if done.length > 0}
		<div class="donehead">
			<button class="toggle" onclick={() => (showDone = !showDone)}>
				{showDone ? '▾' : '▸'} Erledigt ({done.length})
			</button>
			<button class="clear" onclick={clearDone}>Aufräumen</button>
		</div>

		{#if showDone}
			{#each done as item (item.id)}
				{@const meta = metaFor(item)}
				<div class="row is-done">
					<button class="main" onclick={() => toggleItem(item)}>
						<span class="box">✓</span>
						<span class="label">
							<span>{item.name}</span>
							{#if item.quantity}<span class="qty"> · {item.quantity}</span>{/if}
							{#if meta}<span class="meta">{meta}</span>{/if}
						</span>
					</button>
					<button class="del" aria-label="Löschen" onclick={() => deleteItem(item)}>×</button>
				</div>
			{/each}
		{/if}
	{/if}
</main>
