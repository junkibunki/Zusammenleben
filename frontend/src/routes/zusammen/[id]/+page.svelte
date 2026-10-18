<script>
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import AlertCircleIcon from '@lucide/svelte/icons/circle-alert';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import LinkIcon from '@lucide/svelte/icons/link';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import SendIcon from '@lucide/svelte/icons/send-horizontal';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import UserCheckIcon from '@lucide/svelte/icons/user-check';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import { auth, avatarUrl } from '$lib/pocketbase.svelte.js';
	import { households } from '$lib/households.svelte.js';
	import { userLabel, formatWhen } from '$lib/items.svelte.js';
	import {
		together,
		loadEntry,
		watchEntry,
		updateEntry,
		deleteEntry,
		toggleInterested,
		setPlanned,
		setDone,
		loadComments,
		watchComments,
		addComment,
		deleteComment,
		kindOf,
		isInterested,
		canPlan,
		formatPlanned,
		todayIso,
		KINDS,
		TITLE_MAX,
		NOTE_MAX,
		COMMENT_MAX
	} from '$lib/together.svelte.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';

	const ALL = 'all';
	const id = $derived(page.params.id);

	let entry = $state(null);
	let comments = $state([]);
	let loading = $state(true);
	let error = $state('');
	let busy = $state(false);

	// Bearbeiten (nur Autor)
	let editing = $state(false);
	let draft = $state({ title: '', kind: '', note: '', link: '', visibility: ALL });

	// Termin
	let planDate = $state('');
	let planTime = $state('');
	let planning = $state(false);

	// Kommentar
	let comment = $state('');
	let sending = $state(false);

	let confirmDelete = $state(false);

	// "Link kopieren": kurz ein Haken statt des Symbols.
	let copied = $state(false);
	let copiedTimer;

	// Laden + Realtime. Haengt allein an der ID -- was der Ablauf schreibt
	// (`entry`, `comments`), wird hier bewusst nicht gelesen.
	$effect(() => {
		if (!auth.valid) return;
		const wanted = id;
		let cancelled = false;

		loading = true;
		error = '';
		editing = false;
		planning = false;

		Promise.all([loadEntry(wanted), loadComments(wanted)])
			.then(([record, list]) => {
				if (cancelled) return;
				entry = record;
				comments = list;
				loading = false;
			})
			.catch((err) => {
				if (cancelled) return;
				entry = null;
				error =
					err?.status === 404
						? 'Diesen Eintrag gibt es nicht (mehr).'
						: (err?.message ?? 'Laden fehlgeschlagen');
				loading = false;
			});

		const stopEntry = watchEntry(wanted, (action, record) => {
			if (cancelled) return;
			if (action === 'delete') {
				entry = null;
				error = 'Dieser Eintrag wurde gelöscht.';
			} else {
				entry = record;
			}
		});

		const stopComments = watchComments(wanted, (action, record) => {
			if (cancelled) return;
			const idx = comments.findIndex((c) => c.id === record.id);
			if (action === 'delete') {
				if (idx > -1) comments.splice(idx, 1);
			} else if (idx > -1) {
				comments[idx] = record;
			} else {
				comments.push(record);
			}
		});

		return () => {
			cancelled = true;
			stopEntry();
			stopComments();
		};
	});

	const me = $derived(auth.user?.id ?? '');
	const isAuthor = $derived(Boolean(entry) && entry.author === me);
	const joined = $derived(isInterested(entry, me));
	const mayPlan = $derived(canPlan(entry, me));
	const kind = $derived(kindOf(entry?.kind));
	const people = $derived(entry?.expand?.interested ?? []);

	function householdName(hid) {
		if (!hid) return '';
		return households.list.find((h) => h.id === hid)?.name ?? 'Haushalt';
	}

	const meta = $derived.by(() => {
		if (!entry) return '';
		const parts = [];
		const author = userLabel(entry.expand?.author);
		const when = formatWhen(entry.created);
		if (author) parts.push(`von ${author}`);
		if (when) parts.push(when);
		return parts.join(' · ');
	});

	const doneMeta = $derived.by(() => {
		if (!entry?.done_at) return '';
		const who = userLabel(entry.expand?.done_by);
		const when = formatWhen(entry.done_at);
		return ['Gemacht', who ? `abgehakt von ${who}` : '', when].filter(Boolean).join(' · ');
	});

	/** "www.example.com" fuer die Anzeige des Links. */
	function host(url) {
		try {
			return new URL(url).host.replace(/^www\./, '');
		} catch {
			return url;
		}
	}

	function failMessage(err) {
		const data = err?.response?.data ?? {};
		for (const key of Object.keys(data)) if (data[key]?.message) return data[key].message;
		return err?.message ?? 'Speichern fehlgeschlagen';
	}

	// ---- Teilen ----

	// Der Link oeffnet nur fuer Eingeloggte, die den Eintrag sehen duerfen; wer
	// ausgeloggt kommt, landet nach dem Login hier (+layout.svelte, `next`).
	async function copyLink() {
		const url = `${location.origin}/zusammen/${entry.id}`;
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
			clearTimeout(copiedTimer);
			copiedTimer = setTimeout(() => (copied = false), 2000);
		} catch {
			error = `Kopieren ging nicht. Der Link: ${url}`;
		}
	}

	// ---- Bearbeiten ----

	function startEdit() {
		draft = {
			title: entry.title ?? '',
			kind: entry.kind ?? '',
			note: entry.note ?? '',
			link: entry.link ?? '',
			visibility: entry.household || ALL
		};
		editing = true;
		error = '';
	}

	const draftValid = $derived(draft.title.trim().length > 0 && Boolean(draft.kind));

	async function saveEdit(e) {
		e.preventDefault();
		if (busy || !draftValid) return;
		busy = true;
		error = '';
		try {
			let link = draft.link.trim();
			// "maps.app.goo.gl/…" ohne Schema laesst das url-Feld nicht durch.
			if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`;
			entry = await updateEntry(entry, {
				title: draft.title.trim(),
				kind: draft.kind,
				note: draft.note.trim(),
				link,
				household: draft.visibility === ALL ? '' : draft.visibility
			});
			editing = false;
		} catch (err) {
			error = failMessage(err);
		} finally {
			busy = false;
		}
	}

	async function remove() {
		confirmDelete = false;
		busy = true;
		try {
			await deleteEntry(entry);
			goto('/zusammen');
		} catch (err) {
			error = failMessage(err);
			busy = false;
		}
	}

	// ---- Dabei, Termin, Gemacht ----

	async function toggleJoin() {
		await toggleInterested(entry);
		// Der Store schreibt seinen Fehler in `together.error` -- hier anzeigen.
		if (together.error) {
			error = together.error;
			together.error = null;
		}
	}

	function startPlan() {
		const [d, t] = (entry.planned_at || '').split('T');
		planDate = d || todayIso();
		planTime = t || '';
		planning = true;
		error = '';
	}

	async function savePlan(e) {
		e.preventDefault();
		if (busy || !planDate) return;
		busy = true;
		error = '';
		try {
			entry = await setPlanned(entry, planTime ? `${planDate}T${planTime}` : planDate);
			planning = false;
		} catch (err) {
			error = failMessage(err);
		} finally {
			busy = false;
		}
	}

	async function clearPlan() {
		busy = true;
		error = '';
		try {
			entry = await setPlanned(entry, '');
			planning = false;
		} catch (err) {
			error = failMessage(err);
		} finally {
			busy = false;
		}
	}

	async function markDone(done) {
		busy = true;
		error = '';
		try {
			entry = await setDone(entry, done);
		} catch (err) {
			error = failMessage(err);
		} finally {
			busy = false;
		}
	}

	// ---- Kommentare ----

	const commentValid = $derived(comment.trim().length > 0 && comment.length <= COMMENT_MAX);

	async function sendComment(e) {
		e.preventDefault();
		if (sending || !commentValid) return;
		sending = true;
		error = '';
		try {
			const record = await addComment(entry.id, comment);
			// Derselbe Record kommt gleich noch ueber die Subscription.
			if (!comments.some((c) => c.id === record.id)) comments.push(record);
			comment = '';
		} catch (err) {
			error = failMessage(err);
		} finally {
			sending = false;
		}
	}

	async function removeComment(c) {
		const idx = comments.findIndex((x) => x.id === c.id);
		if (idx === -1) return;
		comments.splice(idx, 1);
		try {
			await deleteComment(c);
		} catch (err) {
			comments.splice(idx, 0, c);
			error = failMessage(err);
		}
	}
</script>

{#snippet avatar(user, size = 'size-8')}
	{@const photo = avatarUrl(user)}
	<Avatar.Root class={['shrink-0', size]}>
		{#if photo}
			<Avatar.Image src={photo} alt="" />
		{/if}
		<Avatar.Fallback class="text-xs">
			{(userLabel(user) || '?').charAt(0).toUpperCase()}
		</Avatar.Fallback>
	</Avatar.Root>
{/snippet}

<main class="flex flex-1 flex-col gap-4 px-3 py-4">
	<div>
		<Button variant="ghost" size="lg" class="text-muted-foreground -ml-2 h-11" href="/zusammen">
			<ArrowLeftIcon class="size-4" />
			Zur Übersicht
		</Button>
	</div>

	{#if error}
		<Alert.Root variant="destructive">
			<AlertCircleIcon />
			<Alert.Description>{error}</Alert.Description>
		</Alert.Root>
	{/if}

	{#if loading}
		<p class="text-muted-foreground py-12 text-center text-sm">Lade …</p>
	{:else if entry && editing}
		<Card.Root>
			<form class="flex flex-col gap-(--card-spacing)" onsubmit={saveEdit}>
				<Card.Header>
					<Card.Title>Bearbeiten</Card.Title>
				</Card.Header>
				<Card.Content class="flex flex-col gap-5">
					<div class="grid gap-2">
						<Label for="t-title">Titel</Label>
						<Input
							id="t-title"
							bind:value={draft.title}
							maxlength={TITLE_MAX}
							autocomplete="off"
							class="h-11"
						/>
					</div>
					<div class="grid grid-cols-2 gap-2">
						<div class="grid gap-2">
							<Label>Art</Label>
							<Select.Root
								type="single"
								bind:value={() => draft.kind, (v) => (draft.kind = v || draft.kind)}
							>
								<Select.Trigger class="h-11 w-full data-[size=default]:h-11" aria-label="Art">
									{kindOf(draft.kind).emoji} {kindOf(draft.kind).label}
								</Select.Trigger>
								<Select.Content>
									{#each KINDS as k (k.id)}
										<Select.Item value={k.id} label={k.label}>{k.emoji} {k.label}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
						<div class="grid gap-2">
							<Label>Wer sieht das?</Label>
							<Select.Root
								type="single"
								bind:value={() => draft.visibility, (v) => (draft.visibility = v || ALL)}
							>
								<Select.Trigger
									class="h-11 w-full data-[size=default]:h-11"
									aria-label="Wer sieht das?"
								>
									{draft.visibility === ALL ? 'Für alle' : householdName(draft.visibility)}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value={ALL} label="Für alle">Für alle</Select.Item>
									{#each households.list as h (h.id)}
										<Select.Item value={h.id} label={h.name}>Nur {h.name}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					</div>
					{#if entry.household && draft.visibility === ALL && comments.length > 0}
						<p class="text-muted-foreground -mt-2 text-xs">
							Dann sehen alle Nutzer der App auch die bisherigen Kommentare.
						</p>
					{/if}
					<div class="grid gap-2">
						<Label for="t-link">Link</Label>
						<Input
							id="t-link"
							type="url"
							inputmode="url"
							bind:value={draft.link}
							autocomplete="off"
							placeholder="Maps, Trailer, Rezept …"
							class="h-11"
						/>
					</div>
					<div class="grid gap-2">
						<Label for="t-note">Notiz</Label>
						<Textarea
							id="t-note"
							bind:value={draft.note}
							maxlength={NOTE_MAX}
							rows={5}
							placeholder="Adresse, Öffnungszeiten, wer es empfohlen hat …"
							class="min-h-28"
						/>
					</div>
				</Card.Content>
				<Card.Footer class="flex gap-2">
					<Button
						type="button"
						variant="outline"
						size="lg"
						class="h-11 flex-1"
						onclick={() => (editing = false)}
					>
						Abbrechen
					</Button>
					<Button type="submit" size="lg" class="h-11 flex-1" disabled={busy || !draftValid}>
						{busy ? 'Speichern …' : 'Speichern'}
					</Button>
				</Card.Footer>
			</form>
		</Card.Root>
	{:else if entry}
		<Card.Root>
			<Card.Header>
				<div class="flex items-start gap-3">
					<span class="text-4xl leading-none" aria-hidden="true">{kind.emoji}</span>
					<div class="min-w-0 flex-1">
						<Card.Title class="text-lg" style="overflow-wrap:anywhere">{entry.title}</Card.Title>
						<Card.Description>{meta}</Card.Description>
						<div class="mt-1.5 flex flex-wrap gap-1.5">
							<Badge variant="secondary">{kind.label}</Badge>
							<Badge variant="outline">
								{entry.household ? `Nur ${householdName(entry.household)}` : 'Für alle'}
							</Badge>
						</div>
					</div>
					{#if isAuthor}
						<Button
							variant="ghost"
							size="icon"
							class="text-muted-foreground -mt-1 size-11 shrink-0"
							aria-label="Bearbeiten"
							onclick={startEdit}
						>
							<PencilIcon class="size-4" />
						</Button>
					{/if}
				</div>
			</Card.Header>

			<Card.Content class="flex flex-col gap-4">
				{#if entry.note}
					<p class="text-sm whitespace-pre-line" style="overflow-wrap:anywhere">{entry.note}</p>
				{/if}
				{#if entry.link}
					<a
						href={entry.link}
						target="_blank"
						rel="noopener noreferrer"
						class="text-primary flex min-w-0 items-center gap-1.5 text-sm underline-offset-4 hover:underline"
					>
						<ExternalLinkIcon class="size-4 shrink-0" />
						<span class="truncate">{host(entry.link)}</span>
					</a>
				{/if}

				<!-- Dabei -->
				<div class="flex items-center gap-3">
					<div class="min-w-0 flex-1">
						{#if people.length > 0}
							<div class="flex -space-x-2">
								{#each people.slice(0, 6) as user (user.id)}
									{@render avatar(user, 'size-8 ring-2 ring-card')}
								{/each}
							</div>
							<p class="text-muted-foreground mt-1 truncate text-xs">
								{people.map((u) => userLabel(u)).join(', ')}
							</p>
						{:else}
							<p class="text-muted-foreground text-sm">Noch niemand dabei.</p>
						{/if}
					</div>
					{#if !entry.done_at}
						<Button
							variant={joined ? 'outline' : 'default'}
							size="lg"
							class="h-11 shrink-0"
							aria-pressed={joined}
							onclick={toggleJoin}
						>
							{#if joined}
								<UserCheckIcon class="size-4" /> Bin dabei
							{:else}
								<UserPlusIcon class="size-4" /> Ich auch!
							{/if}
						</Button>
					{/if}
				</div>

				<!-- Termin / Gemacht -->
				{#if entry.done_at}
					<div class="bg-muted flex items-center gap-3 rounded-lg p-3">
						<CheckIcon class="size-5 shrink-0" />
						<p class="min-w-0 flex-1 text-sm">{doneMeta}</p>
						{#if mayPlan}
							<Button
								variant="ghost"
								size="icon"
								class="text-muted-foreground size-11 shrink-0"
								aria-label="Wieder öffnen"
								disabled={busy}
								onclick={() => markDone(false)}
							>
								<RotateCcwIcon class="size-4" />
							</Button>
						{/if}
					</div>
				{:else if planning}
					<form class="bg-muted flex flex-col gap-3 rounded-lg p-3" onsubmit={savePlan}>
						<div class="grid grid-cols-2 gap-2">
							<div class="grid gap-1.5">
								<Label for="t-date">Datum</Label>
								<Input
									id="t-date"
									type="date"
									bind:value={planDate}
									required
									class="bg-background h-11 min-w-0"
								/>
							</div>
							<div class="grid gap-1.5">
								<Label for="t-time">Uhrzeit (optional)</Label>
								<Input
									id="t-time"
									type="time"
									bind:value={planTime}
									class="bg-background h-11 min-w-0"
								/>
							</div>
						</div>
						<div class="flex gap-2">
							{#if entry.planned_at}
								<Button
									type="button"
									variant="ghost"
									class="h-11"
									disabled={busy}
									onclick={clearPlan}
								>
									Entfernen
								</Button>
							{/if}
							<span class="flex-1"></span>
							<Button
								type="button"
								variant="outline"
								class="h-11"
								onclick={() => (planning = false)}
							>
								Abbrechen
							</Button>
							<Button type="submit" class="h-11" disabled={busy || !planDate}>Speichern</Button>
						</div>
						<p class="text-muted-foreground text-xs">
							Alle, die dabei sind, bekommen eine Benachrichtigung.
						</p>
					</form>
				{:else}
					<div class="flex flex-wrap items-center gap-2">
						{#if entry.planned_at}
							<p class="flex flex-1 items-center gap-2 text-sm font-medium">
								<CalendarIcon class="size-4" />
								{formatPlanned(entry.planned_at)}
							</p>
						{/if}
						{#if mayPlan}
							<Button variant="outline" class="h-11" onclick={startPlan}>
								<CalendarIcon class="size-4" />
								{entry.planned_at ? 'Verschieben' : 'Termin festlegen'}
							</Button>
							<Button variant="outline" class="h-11" disabled={busy} onclick={() => markDone(true)}>
								<CheckIcon class="size-4" />
								Haben wir gemacht
							</Button>
						{:else if !entry.planned_at}
							<p class="text-muted-foreground text-xs">
								Wer dabei ist, kann einen Termin festlegen.
							</p>
						{/if}
					</div>
				{/if}
			</Card.Content>

			<Card.Footer class="flex gap-2">
				{#if isAuthor}
					<Button
						variant="ghost"
						class="text-destructive -ml-2 h-11"
						disabled={busy}
						onclick={() => (confirmDelete = true)}
					>
						<Trash2Icon class="size-4" />
						Löschen
					</Button>
				{/if}
				<span class="flex-1"></span>
				<Button variant="ghost" class="text-muted-foreground -mr-2 h-11" onclick={copyLink}>
					{#if copied}
						<CheckIcon class="size-4" />
						Kopiert
					{:else}
						<LinkIcon class="size-4" />
						Link kopieren
					{/if}
				</Button>
			</Card.Footer>
		</Card.Root>

		<!-- Kommentare -->
		<section class="flex flex-col gap-2">
			<h2 class="text-muted-foreground px-1 text-xs font-medium uppercase">
				Kommentare{comments.length > 0 ? ` (${comments.length})` : ''}
			</h2>
			{#if comments.length > 0}
				<ul class="surface divide-y">
					{#each comments as c (c.id)}
						<li class="flex items-start gap-3 py-3 pr-1 pl-3">
							{@render avatar(c.expand?.author)}
							<div class="min-w-0 flex-1">
								<p class="text-muted-foreground truncate text-xs">
									{[userLabel(c.expand?.author), formatWhen(c.created)].filter(Boolean).join(' · ')}
								</p>
								<p class="text-sm whitespace-pre-line" style="overflow-wrap:anywhere">{c.text}</p>
							</div>
							{#if c.author === me}
								<Button
									variant="ghost"
									size="icon"
									class="text-muted-foreground size-11 shrink-0"
									aria-label="Kommentar löschen"
									onclick={() => removeComment(c)}
								>
									<Trash2Icon class="size-4" />
								</Button>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
			<form class="flex items-end gap-2" onsubmit={sendComment}>
				<Textarea
					bind:value={comment}
					maxlength={COMMENT_MAX}
					rows={1}
					aria-label="Kommentar"
					placeholder="Ich kann erst ab 15 Uhr …"
					class="min-h-11 flex-1"
				/>
				<Button
					type="submit"
					size="icon"
					class="size-11 shrink-0"
					aria-label="Kommentar senden"
					disabled={sending || !commentValid}
				>
					<SendIcon class="size-4" />
				</Button>
			</form>
		</section>
	{/if}
</main>

<AlertDialog.Root bind:open={confirmDelete}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Eintrag löschen?</AlertDialog.Title>
			<AlertDialog.Description>
				Der Eintrag verschwindet für alle, samt Kommentaren.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel class="h-11">Abbrechen</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" class="h-11" onclick={remove}>
				Löschen
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
