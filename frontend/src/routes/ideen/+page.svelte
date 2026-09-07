<script>
	import CheckIcon from '@lucide/svelte/icons/check';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import XIcon from '@lucide/svelte/icons/x';
	import { auth, avatarUrl } from '$lib/pocketbase.svelte.js';
	import { userLabel, formatWhen } from '$lib/items.svelte.js';
	import {
		ideas,
		syncIdeas,
		addIdea,
		setIdeaStatus,
		isResolved,
		IDEA_MAX
	} from '$lib/ideas.svelte.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';

	let draft = $state('');
	let posting = $state(false);

	// Die Idee, ueber die der Bestaetigungsdialog gerade entscheidet.
	let pending = $state(null);
	let confirmOpen = $state(false);

	// Laden + Realtime-Subscription; Teardown beim Verlassen der Seite.
	$effect(() => {
		if (!auth.valid) return;
		return syncIdeas();
	});

	const valid = $derived(draft.trim().length > 0 && draft.length <= IDEA_MAX);

	async function submit(e) {
		e.preventDefault();
		if (!valid || posting) return;

		const text = draft;
		posting = true;
		try {
			await addIdea(text);
			draft = '';
		} catch (err) {
			// Den Entwurf stehen lassen -- er ist laenger als ein Listeneintrag.
			ideas.error = err?.message ?? 'Posten fehlgeschlagen';
		} finally {
			posting = false;
		}
	}

	function askResolve(idea) {
		pending = idea;
		confirmOpen = true;
	}

	function resolve(status) {
		const idea = pending;
		if (!idea) return;

		// Selbst schliessen: `AlertDialog.Action` schliesst *nicht* von allein,
		// sobald ein eigenes onclick daran haengt (docs/pitfalls/designsystem.md,
		// nachgemessen auf der Gundula-Seite).
		// `pending` bleibt stehen, bis der naechste Knopf es ueberschreibt: waehrend
		// der Ausblend-Animation soll der zitierte Text nicht verschwinden.
		confirmOpen = false;
		setIdeaStatus(idea, status);
	}

	/** Anfang des Vorschlags -- fuer die Knopfnamen, damit jede Zeile anders heisst. */
	function shortText(idea) {
		const text = idea.text.replace(/\s+/g, ' ').trim();
		return text.length > 40 ? `${text.slice(0, 40)}…` : text;
	}

	/** "Anna · heute 19:41" -- leere Teile fallen raus. */
	function metaFor(idea) {
		const parts = [];
		const author = userLabel(idea.expand?.author);
		const when = formatWhen(idea.created);
		if (author) parts.push(author);
		if (when) parts.push(when);
		return parts.join(' · ');
	}

	/** "umgesetzt von Papa · heute 20:00" -- nur bei abgehakten Ideen. */
	function resolvedMetaFor(idea) {
		if (!isResolved(idea)) return '';
		const who = userLabel(idea.expand?.resolved_by);
		const when = formatWhen(idea.resolved_at);
		const parts = [who ? `${idea.status} von ${who}` : idea.status];
		if (when) parts.push(when);
		return parts.join(' · ');
	}
</script>

<form class="bg-background border-b px-3 py-2.5" onsubmit={submit}>
	<Textarea
		bind:value={draft}
		maxlength={IDEA_MAX}
		rows={2}
		autocomplete="off"
		aria-label="Neue Idee"
		placeholder="Was könnte die App noch können?"
		class="min-h-20"
	/>
	<div class="mt-2 flex items-center gap-2">
		<p class="text-muted-foreground flex-1 text-xs">
			Jeder sieht deinen Vorschlag im Feed.
		</p>
		<Button type="submit" size="lg" class="h-11" disabled={!valid || posting}>
			{posting ? 'Poste …' : 'Posten'}
		</Button>
	</div>
</form>

{#if ideas.error}
	<div class="px-3 pt-3">
		<Alert.Root variant="destructive">
			<Alert.Description>{ideas.error}</Alert.Description>
			<Alert.Action>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Meldung schließen"
					onclick={() => (ideas.error = null)}
				>
					<XIcon class="size-4" />
				</Button>
			</Alert.Action>
		</Alert.Root>
	</div>
{/if}

<main class="flex-1 px-3 pt-3 pb-8">
	{#if ideas.loading}
		<p class="text-muted-foreground py-12 text-center text-sm">Lade …</p>
	{:else if ideas.items.length === 0}
		<p class="text-muted-foreground py-12 text-center text-sm">
			Noch keine Ideen. Fang an. 💡
		</p>
	{:else}
		<!-- Neuste zuerst; die Reihenfolge kommt aus dem Store (sort '-created'). -->
		<ul class="bg-card divide-y overflow-hidden rounded-lg border">
			{#each ideas.items as idea (idea.id)}
				{@const photo = avatarUrl(idea.expand?.author)}
				{@const author = userLabel(idea.expand?.author)}
				{@const resolved = isResolved(idea)}
				{@const resolvedMeta = resolvedMetaFor(idea)}
				<li class="flex items-start gap-3 py-3 pr-1 pl-3" class:opacity-60={resolved}>
					<Avatar.Root class="mt-0.5 shrink-0">
						{#if photo}
							<Avatar.Image src={photo} alt="" />
						{/if}
						<Avatar.Fallback class="text-xs">
							{(author || '?').charAt(0).toUpperCase()}
						</Avatar.Fallback>
					</Avatar.Root>

					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
							<span class="text-muted-foreground truncate text-xs">{metaFor(idea)}</span>
							{#if resolved}
								<Badge variant={idea.status === 'umgesetzt' ? 'secondary' : 'outline'}>
									{idea.status}
								</Badge>
							{/if}
						</div>
						<p class="whitespace-pre-line" class:line-through={resolved}>{idea.text}</p>
						{#if resolvedMeta}
							<span class="text-muted-foreground block truncate text-xs">{resolvedMeta}</span>
						{/if}
					</div>

					{#if resolved}
						<Button
							variant="ghost"
							size="icon"
							class="text-muted-foreground size-11 shrink-0"
							aria-label={`„${shortText(idea)}“ wieder öffnen`}
							onclick={() => setIdeaStatus(idea, '')}
						>
							<RotateCcwIcon class="size-4" />
						</Button>
					{:else}
						<Button
							variant="ghost"
							size="icon"
							class="text-muted-foreground size-11 shrink-0"
							aria-label={`„${shortText(idea)}“ abhaken`}
							onclick={() => askResolve(idea)}
						>
							<CheckIcon class="size-4" />
						</Button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</main>

<AlertDialog.Root bind:open={confirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Idee abhaken?</AlertDialog.Title>
			<AlertDialog.Description>
				Für alle sichtbar erledigt. Wurde die Idee umgesetzt oder abgelehnt?
			</AlertDialog.Description>
		</AlertDialog.Header>

		{#if pending}
			<p class="text-muted-foreground line-clamp-4 text-xs whitespace-pre-line">{pending.text}</p>
		{/if}

		<AlertDialog.Footer>
			<AlertDialog.Cancel class="h-11">Abbrechen</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="outline"
				class="h-11"
				onclick={() => resolve('abgelehnt')}
			>
				Abgelehnt
			</AlertDialog.Action>
			<AlertDialog.Action class="h-11" onclick={() => resolve('umgesetzt')}>
				Umgesetzt
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
