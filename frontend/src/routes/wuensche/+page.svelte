<script>
	import GiftIcon from '@lucide/svelte/icons/gift';
	import XIcon from '@lucide/svelte/icons/x';
	import { auth, avatarUrl } from '$lib/pocketbase.svelte.js';
	import { households, listMembers } from '$lib/households.svelte.js';
	import { userLabel, formatWhen } from '$lib/items.svelte.js';
	import {
		wishes,
		syncWishes,
		addWish,
		wishErrorMessage,
		WISH_MAX,
		WISH_NOTE_MAX
	} from '$lib/wishes.svelte.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';

	let draft = $state('');
	let noteDraft = $state('');
	let posting = $state(false);

	// Der Fehler am Eingabefeld (vor allem: schon gewuenscht). Getrennt von
	// `wishes.error`, das vom Laden und von Realtime kommt.
	let formError = $state('');
	// Ein angelegter Wunsch verschwindet fuer den Wuenschenden sofort -- ohne
	// diese Bestaetigung sieht die Seite aus, als haette sie nichts getan.
	let posted = $state('');

	// Laden + Realtime-Subscription; Teardown beim Verlassen der Seite.
	$effect(() => {
		const household = households.activeId;
		if (!auth.valid || !household) return;
		return syncWishes(household);
	});

	// Laufende Mitglieder des Haushalts -- fuer wen ein Wunsch notiert werden kann.
	let members = $state([]);
	// Bis die Liste da ist, steht die Auswahl auf "Für mich" und springt danach
	// um -- wer vorher abschickt, traefe die falsche Person. Daher wartet der Knopf.
	let membersReady = $state(false);
	$effect(() => {
		const household = households.activeId;
		members = [];
		membersReady = false;
		if (!auth.valid || !household) return;
		let cancelled = false;
		listMembers(household)
			.then((list) => {
				if (!cancelled) members = list.filter((m) => m.membership.active);
			})
			.catch(() => {
				// Ohne Mitgliederliste bleibt nur der eigene Wunsch -- wie vorher.
			})
			.finally(() => {
				if (!cancelled) membersReady = true;
			});
		return () => (cancelled = true);
	});

	const me = $derived(auth.user?.id ?? '');

	// Die anderen nach Name; Haupt-Mitglieder zuerst, damit die Vorauswahl
	// (ein anderes Haupt-Mitglied) auch die erste Zeile der Auswahl ist.
	const others = $derived(
		members
			.filter((m) => m.id !== me)
			.sort(
				(a, b) =>
					(a.membership.role === 'haupt' ? 0 : 1) - (b.membership.role === 'haupt' ? 0 : 1) ||
					userLabel(a).localeCompare(userLabel(b), 'de')
			)
	);

	// Gewaehlt wird nur ueber `chosen`; leer oder nicht mehr im Haushalt heisst
	// Vorauswahl. bits-ui setzt beim erneuten Antippen des gewaehlten Eintrags
	// "" (docs/pitfalls/designsystem.md) -- das ignoriert der Setter unten.
	// Vorausgewaehlt ist nur ein anderes *Haupt*-Mitglied; gibt es keins, der
	// eigene Wunsch -- ein Gast waere als Vorauswahl ein Zufall.
	let chosen = $state('');
	const target = $derived(
		chosen === me || others.some((m) => m.id === chosen)
			? chosen
			: (others.find((m) => m.membership.role === 'haupt')?.id ?? me)
	);
	const targetUser = $derived(others.find((m) => m.id === target) ?? null);
	const forMe = $derived(!targetUser);
	const targetName = $derived(userLabel(targetUser) || 'Jemand');

	const valid = $derived(membersReady && draft.trim().length > 0 && draft.length <= WISH_MAX);

	/**
	 * Ein Block pro Person. Nach Name sortiert, nicht nach Zeit: die Frage auf
	 * dieser Seite ist "was will X?", nicht "wer war zuletzt dran". Innerhalb
	 * eines Blocks bleibt die Reihenfolge des Stores (neuste zuerst).
	 */
	const groups = $derived.by(() => {
		const byWisher = new Map();
		for (const wish of wishes.items) {
			const id = wish.wisher || wish.expand?.wisher?.id || '';
			let group = byWisher.get(id);
			if (!group) {
				group = { id, user: wish.expand?.wisher ?? null, items: [] };
				byWisher.set(id, group);
			}
			group.items.push(wish);
		}
		return [...byWisher.values()].sort((a, b) =>
			userLabel(a.user).localeCompare(userLabel(b.user), 'de')
		);
	});

	async function submit(e) {
		e.preventDefault();
		if (!valid || posting) return;

		const text = draft;
		// Festhalten: die Bestaetigung soll die Person nennen, fuer die es war,
		// auch wenn die Auswahl inzwischen wechselt.
		const own = forMe;
		const name = targetName;
		posting = true;
		formError = '';
		posted = '';
		try {
			await addWish(text, noteDraft, target);
			draft = '';
			noteDraft = '';
			posted = own
				? `„${text.trim()}“ ist notiert und für dich ab jetzt unsichtbar.`
				: `„${text.trim()}“ steht jetzt bei ${name} — ${name} sieht es nicht.`;
		} catch (err) {
			// Den Entwurf stehen lassen: bei einem Doppelten will die Person ihn
			// umformulieren, nicht neu tippen.
			formError = wishErrorMessage(err, own) ?? err?.message ?? 'Wünschen fehlgeschlagen';
		} finally {
			posting = false;
		}
	}
</script>

<form class="bg-background border-b px-3 py-2.5" onsubmit={submit}>
	{#if others.length > 0}
		<!-- Ohne andere Mitglieder (oder solange sie laden) gibt es nur den eigenen
		     Wunsch -- dann braucht es keine Auswahl. -->
		<Select.Root
			type="single"
			bind:value={
				() => target,
				(v) => {
					if (!v) return;
					chosen = v;
					formError = '';
					posted = '';
				}
			}
		>
			<Select.Trigger class="mb-2 h-11 w-full data-[size=default]:h-11" aria-label="Für wen?">
				{forMe ? 'Für mich' : `Idee für ${targetName}`}
			</Select.Trigger>
			<Select.Content>
				{#each others as user (user.id)}
					{@const label = `Idee für ${userLabel(user)}`}
					<Select.Item value={user.id} {label}>{label}</Select.Item>
				{/each}
				<Select.Item value={me} label="Für mich">Für mich</Select.Item>
			</Select.Content>
		</Select.Root>
	{/if}
	<div class="flex items-start gap-2">
		<Input
			bind:value={draft}
			maxlength={WISH_MAX}
			autocomplete="off"
			aria-label={forMe ? 'Dein Wunsch' : `Idee für ${targetName}`}
			aria-invalid={formError ? 'true' : undefined}
			aria-describedby="wunsch-hinweis"
			placeholder={forMe ? 'Was wünschst du dir?' : `Was könnte ${targetName} gefallen?`}
			class="h-11"
			oninput={() => {
				formError = '';
				posted = '';
			}}
		/>
		<Button type="submit" size="lg" class="h-11 shrink-0" disabled={!valid || posting}>
			{#if forMe}
				{posting ? 'Wünsche …' : 'Wünschen'}
			{:else}
				{posting ? 'Notiere …' : 'Notieren'}
			{/if}
		</Button>
	</div>
	<Textarea
		bind:value={noteDraft}
		maxlength={WISH_NOTE_MAX}
		rows={2}
		aria-label="Beschreibung (optional)"
		placeholder="Beschreibung, Größe, Farbe, Link … (optional)"
		class="mt-2 min-h-16"
		oninput={() => {
			formError = '';
			posted = '';
		}}
	/>
	<div id="wunsch-hinweis" class="text-muted-foreground mt-2 flex items-center gap-2 text-xs">
		<p class="min-w-0 flex-1">
			{#if forMe}
				Alle anderen sehen deinen Wunsch — du selbst nicht mehr.
			{:else}
				Du und die anderen sehen die Idee bei {targetName} — {targetName} selbst nicht.
			{/if}
		</p>
		{#if wishes.mine !== null}
			<!-- Die Zahl ist alles, was der Server ueber die eigene Liste herausgibt. -->
			<Badge
				variant="secondary"
				class="font-normal"
				title="Deine eigenen Wünsche bleiben dir verborgen — nur wie viele es sind, siehst du."
			>
				<GiftIcon />
				{wishes.mine}
				{wishes.mine === 1 ? 'Wunsch' : 'Wünsche'} von dir
			</Badge>
		{/if}
	</div>
</form>

{#if formError}
	<div class="px-3 pt-3">
		<Alert.Root variant="destructive">
			<Alert.Description>{formError}</Alert.Description>
			<Alert.Action>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Meldung schließen"
					onclick={() => (formError = '')}
				>
					<XIcon class="size-4" />
				</Button>
			</Alert.Action>
		</Alert.Root>
	</div>
{/if}

{#if posted}
	<div class="px-3 pt-3">
		<Alert.Root>
			<GiftIcon class="size-4" />
			<Alert.Description>{posted}</Alert.Description>
			<Alert.Action>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Meldung schließen"
					onclick={() => (posted = '')}
				>
					<XIcon class="size-4" />
				</Button>
			</Alert.Action>
		</Alert.Root>
	</div>
{/if}

{#if wishes.error}
	<div class="px-3 pt-3">
		<Alert.Root variant="destructive">
			<Alert.Description>{wishes.error}</Alert.Description>
			<Alert.Action>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Meldung schließen"
					onclick={() => (wishes.error = null)}
				>
					<XIcon class="size-4" />
				</Button>
			</Alert.Action>
		</Alert.Root>
	</div>
{/if}

<main class="flex-1 px-3 pt-3 pb-8">
	{#if wishes.loading}
		<p class="text-muted-foreground py-12 text-center text-sm">Lade …</p>
	{:else if groups.length === 0}
		<p class="text-muted-foreground py-12 text-center text-sm">
			Noch kein Wunsch von den anderen. Deine eigenen stehen hier nie. 🎁
		</p>
	{:else}
		<div class="flex flex-col gap-4">
			{#each groups as group (group.id)}
				{@const photo = avatarUrl(group.user)}
				{@const name = userLabel(group.user) || 'Jemand'}
				<section class="surface">
					<h2 class="flex items-center gap-3 border-b px-3 py-2.5">
						<Avatar.Root class="shrink-0">
							{#if photo}
								<Avatar.Image src={photo} alt="" />
							{/if}
							<Avatar.Fallback class="text-xs">
								{name.charAt(0).toUpperCase()}
							</Avatar.Fallback>
						</Avatar.Root>
						<span class="min-w-0 flex-1 truncate font-semibold">{name}</span>
						<span class="text-muted-foreground shrink-0 text-xs">
							{group.items.length}
							{group.items.length === 1 ? 'Wunsch' : 'Wünsche'}
						</span>
					</h2>
					<ul class="divide-y">
						{#each group.items as wish (wish.id)}
							{@const when = formatWhen(wish.created)}
							<!-- Leerer `author` (Admin-UI) zaehlt als eigener Wunsch, wie im Hook. -->
							{@const idea = wish.author && wish.author !== wish.wisher}
							{@const ideaBy =
								wish.author === me ? 'Deine Idee' : `Idee von ${userLabel(wish.expand?.author) || 'jemandem'}`}
							{@const meta = [when, idea ? ideaBy : ''].filter(Boolean).join(' · ')}
							<li class="px-3 py-2.5">
								<p class="break-words">{wish.text}</p>
								{#if wish.note}
									<p class="text-muted-foreground mt-0.5 break-words whitespace-pre-line text-sm">
										{wish.note}
									</p>
								{/if}
								{#if meta}
									<span class="text-muted-foreground block text-xs">{meta}</span>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	{/if}
</main>
