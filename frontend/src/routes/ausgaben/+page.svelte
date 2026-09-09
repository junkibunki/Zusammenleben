<script>
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { auth, avatarUrl, listUsers } from '$lib/pocketbase.svelte.js';
	import { userLabel, formatWhen } from '$lib/items.svelte.js';
	import {
		expenses,
		syncExpenses,
		addExpense,
		deleteExpense,
		newExpenseId,
		splitShares,
		computeSettlement,
		countsIn,
		formatEuro,
		parseAmount,
		TITLE_MAX,
		AMOUNT_MAX_CENTS,
		MEMBERS_MAX
	} from '$lib/expenses.svelte.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	let users = $state([]);
	let usersLoading = $state(true);
	let usersFailed = $state(false); // getrennt von `error`: die Meldung ist wegklickbar
	let attempt = $state(0); // erhoeht der "Erneut laden"-Knopf, startet den Effekt neu

	let title = $state('');
	let amount = $state('');
	let payer = $state(''); // leer heisst "ich", siehe `paidBy`
	let picked = $state([]); // User-IDs, auf die geteilt wird
	let posting = $state(false);

	// Die ID des Eintrags steht schon fest, bevor er gespeichert wird: sie
	// entscheidet in `splitShares`, wer den Restcent traegt. Ohne sie zeigte die
	// Vorschau unten eine andere Aufteilung als hinterher die Liste.
	let draftId = $state(newExpenseId());

	let pending = $state(null); // die Ausgabe, ueber die der Dialog entscheidet
	let confirmOpen = $state(false);

	// Aufklappzustand der drei Blocks, alle zu. Bewusst *nicht* im localStorage
	// wie die Warengruppen der Liste (`collapse.svelte.js`): dort ist das Zuklappen
	// eine Entscheidung fuer den ganzen Einkauf, hier gilt sie fuer einen Eintrag.
	let payerOpen = $state(false);
	let splitOpen = $state(false);
	let debtsOpen = $state(false);

	// Laden + Realtime-Subscription; Teardown beim Verlassen der Seite.
	$effect(() => {
		if (!auth.valid) return;
		return syncExpenses();
	});

	// Die Bewohner kommen aus `users`, nicht aus den Ausgaben: geteilt wird auf
	// alle, die es *jetzt* gibt. Der Effekt liest bewusst nichts von dem, was
	// sein eigener Rueckweg schreibt (siehe CLAUDE.md).
	$effect(() => {
		attempt;
		if (!auth.valid) return;
		let cancelled = false;
		usersLoading = true;
		usersFailed = false;

		listUsers()
			.then((records) => {
				if (cancelled) return;
				users = records;
				// Vorauswahl: alle. Nur beim Laden -- ein spaeteres Abwaehlen soll
				// nicht wieder zurueckspringen.
				picked = records.map((u) => u.id);
				usersLoading = false;
			})
			.catch(() => {
				if (cancelled) return;
				usersFailed = true;
				usersLoading = false;
			});

		return () => (cancelled = true);
	});

	// Nach Anzeigenamen sortiert, wie auf der Bewohner-Seite.
	const residents = $derived(
		[...users].sort((a, b) => userLabel(a).localeCompare(userLabel(b), 'de'))
	);

	/**
	 * Namen und Fotos zu allen IDs, die auf der Seite vorkommen. Die
	 * Bewohnerliste allein genuegt nicht: scheitert `listUsers()`, stehen die
	 * Namen nur noch in den expands der Ausgaben -- die Auswertung soll dann
	 * trotzdem lesbar bleiben. Ein *geloeschter* Account hinterlaesst dagegen
	 * auch kein expand mehr; fuer den greift der Fallback in `nameOf`.
	 */
	const people = $derived.by(() => {
		const map = new Map();
		for (const u of users) map.set(u.id, u);
		for (const e of expenses.items) {
			// `created_by` gehoert dazu: `metaFor` zeigt den Namen an, wenn der
			// Eintragende nicht der Zahler war.
			const involved = [e.expand?.paid_by, e.expand?.created_by, ...(e.expand?.shared_with ?? [])];
			for (const u of involved) if (u && !map.has(u.id)) map.set(u.id, u);
		}
		return map;
	});

	/** Anzeigename zu einer ID; "" nur, wenn gar keine ID da ist. */
	function nameOf(id) {
		if (!id) return '';
		// userLabel() gibt fuer einen unbekannten Record "" zurueck -- eine Zeile
		// mit Betrag und ohne Namen waere hier nicht zu deuten.
		return userLabel(people.get(id)) || 'Jemand';
	}

	// Ein Single-Select von bits-ui laesst sich abwaehlen (docs/pitfalls/
	// designsystem.md) -- der Wert wird deshalb an *einer* Stelle normalisiert.
	const paidBy = $derived(payer || auth.user?.id || '');
	const amountCents = $derived(parseAmount(amount));
	const valid = $derived(
		title.trim().length > 0 &&
			amountCents !== null &&
			paidBy !== '' &&
			picked.length > 0 &&
			picked.length <= MEMBERS_MAX
	);

	// Vorschau der Aufteilung, waehrend getippt wird -- mit derselben ID, die der
	// Eintrag hinterher hat, also mit derselben Verteilung des Restcents.
	const preview = $derived(splitShares(amountCents ?? 0, picked, draftId));

	// Zahler und einziger Teilnehmer dieselbe Person: erlaubt (eine Ausgabe nur
	// fuer sich), zaehlt aber in keinem Saldo mit -- das soll vorher dastehen und
	// nicht hinterher auffallen.
	const onlyPayer = $derived(picked.length === 1 && picked[0] === paidBy);

	function togglePicked(id) {
		const i = picked.indexOf(id);
		if (i > -1) picked.splice(i, 1);
		else picked.push(id);
	}

	async function submit(e) {
		e.preventDefault();
		if (!valid || posting) return;

		posting = true;
		try {
			const { mismatch } = await addExpense({
				id: draftId,
				title,
				amountCents,
				paidBy,
				sharedWith: picked
			});
			// Nur Bezeichnung und Betrag zuruecksetzen: Zahler und Aufteilung sind
			// beim naechsten Einkauf meist wieder dieselben.
			title = '';
			amount = '';
			draftId = newExpenseId();

			// Die Ausgabe lag schon mit anderen Werten auf dem Server: gespeichert
			// ist der erste Versuch, nicht der zweite. Das muss dastehen -- der
			// Eintrag ist jetzt in der Liste und sieht nach dem aus, was gerade
			// abgeschickt wurde.
			if (mismatch) {
				expenses.error =
					'Diese Ausgabe war bereits gespeichert — mit den zuerst abgeschickten Werten. ' +
					'Deine Änderung ist nicht angekommen: bitte den Eintrag löschen und neu eintragen.';
			}
		} catch (err) {
			// Den Entwurf stehen lassen -- er ist mehr als ein Feld. Die ID bleibt
			// auch stehen: ein zweiter Versuch soll denselben Eintrag treffen.
			expenses.error = err?.userFacing
				? err.message
				: 'Die Ausgabe konnte nicht eingetragen werden.';
		} finally {
			posting = false;
		}
	}

	function askDelete(expense) {
		pending = expense;
		confirmOpen = true;
	}

	function confirmDelete() {
		const expense = pending;
		if (!expense) return;
		// `AlertDialog.Action` schliesst nicht von allein, sobald ein eigenes
		// onclick daran haengt (docs/pitfalls/designsystem.md).
		confirmOpen = false;
		deleteExpense(expense);
	}

	// Ein Durchlauf fuer beide Anzeigen -- sie koennen sich damit nicht
	// widersprechen (und die Rechnung laeuft nicht zweimal).
	const settlement = $derived(computeSettlement(expenses.items));

	// Alle Bewohner erscheinen, auch mit Saldo 0 -- "ausgeglichen" ist eine
	// Aussage, eine fehlende Zeile waere keine. Groesstes Guthaben zuerst.
	const saldi = $derived(
		[...new Set([...residents.map((u) => u.id), ...people.keys()])]
			.map((id) => ({ id, cents: settlement.balances.get(id) ?? 0 }))
			.sort((a, b) => b.cents - a.cents || nameOf(a.id).localeCompare(nameOf(b.id), 'de'))
	);

	/** "bezahlt von Anna · heute 19:41" -- plus den Eintragenden, falls das ein anderer war. */
	function metaFor(expense) {
		const parts = [];
		const who = nameOf(expense.paid_by);
		if (who) parts.push(`bezahlt von ${who}`);

		const by = expense.created_by;
		if (by && by !== expense.paid_by) parts.push(`eingetragen von ${nameOf(by)}`);

		const when = formatWhen(expense.created);
		if (when) parts.push(when);
		return parts.join(' · ');
	}
</script>

<!-- Ueberschrift und Schalter in einem, wie die Warengruppen auf der Liste: fuer
     Screenreader eine Gliederungsebene, fuer den Daumen eine 44px hohe Flaeche.
     Die 44px bleiben (docs/pitfalls/designsystem.md), die Schrift ist bewusst
     kleiner als die echten Labels darueber -- das hier sind Nebenschalter, keine
     Felder. `summary` steht rechts und traegt den Zustand, den das Zuklappen
     verdeckt; der Wert ist dabei kraeftiger als seine Beschriftung. -->
{#snippet sectionToggle(label, summary, open, toggle)}
	<h2>
		<button
			type="button"
			class="focus-visible:ring-ring/50 flex h-11 w-full items-center gap-1.5 rounded-md text-left text-xs outline-none focus-visible:ring-[3px]"
			aria-expanded={open}
			onclick={toggle}
		>
			{#if open}
				<ChevronDownIcon class="text-muted-foreground size-3.5 shrink-0" />
			{:else}
				<ChevronRightIcon class="text-muted-foreground size-3.5 shrink-0" />
			{/if}
			<span class="text-muted-foreground shrink-0 font-medium">{label}</span>
			<span class="min-w-0 flex-1 truncate text-right">{summary}</span>
		</button>
	</h2>
{/snippet}

<!-- Nur die Faelle, in denen etwas nicht stimmt. Die reine Zahl der Teilnehmer
     stand hier auch schon -- sie steht aber ohnehin rechts am Schalter, und
     zweimal dasselbe kostet nur Platz. -->
{#snippet splitWarning()}
	{#if picked.length === 0}
		<p class="text-muted-foreground px-1 text-xs">
			Niemand ausgewählt — mindestens eine Person muss mitzahlen.
		</p>
	{:else if picked.length > MEMBERS_MAX}
		<p class="text-muted-foreground px-1 text-xs">
			Höchstens {MEMBERS_MAX} Personen können mitzahlen.
		</p>
	{:else if onlyPayer}
		<p class="text-muted-foreground px-1 text-xs">
			Nur der Zahler ausgewählt — der Eintrag verschiebt keinen Saldo.
		</p>
	{/if}
{/snippet}

<main class="flex flex-1 flex-col gap-4 px-3 py-4">
	{#if expenses.error}
		<Alert.Root variant="destructive">
			<Alert.Description>{expenses.error}</Alert.Description>
			<Alert.Action>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Meldung schließen"
					onclick={() => (expenses.error = null)}
				>
					<XIcon class="size-4" />
				</Button>
			</Alert.Action>
		</Alert.Root>
	{/if}

	<!-- ------------------------------------------------------ Neue Ausgabe -->
	<Card.Root>
		<form class="flex flex-col gap-(--card-spacing)" onsubmit={submit}>
			<Card.Header>
				<Card.Title>Neue Ausgabe</Card.Title>
			</Card.Header>

			<!-- `gap-4` statt `gap-6`: die beiden Klappschalter darunter sind je 44px
			     hoch und bringen damit schon genug Luft mit. -->
			<Card.Content class="flex flex-col gap-4">
				<div class="grid gap-2">
					<Label for="expense-title">Bezeichnung</Label>
					<Input
						id="expense-title"
						type="text"
						bind:value={title}
						maxlength={TITLE_MAX}
						autocomplete="off"
						placeholder="z.B. Großeinkauf Rewe"
						class="h-11"
					/>
				</div>

				<div class="grid gap-2">
					<Label for="expense-amount">Betrag</Label>
					<div class="flex items-center gap-2">
						<Input
							id="expense-amount"
							type="text"
							inputmode="decimal"
							bind:value={amount}
							autocomplete="off"
							placeholder="0,00"
							class="h-11 flex-1"
							aria-describedby="expense-amount-hint"
						/>
						<span class="text-muted-foreground shrink-0 text-sm">€</span>
					</div>
					<p id="expense-amount-hint" class="text-muted-foreground text-xs">
						{#if amount.trim() !== '' && amountCents === null}
							Bitte einen Betrag zwischen 0,01 und {formatEuro(AMOUNT_MAX_CENTS)} eintragen.
						{:else}
							Komma oder Punkt, beides geht.
						{/if}
					</p>
				</div>

				<!-- Beide Blocks starten zugeklappt: der Normalfall ist "alle zahlen,
				     ich habe ausgelegt", und dafuer genuegen Bezeichnung und Betrag.
				     Der Schalter zeigt zugeklappt, was gilt -- sonst muesste man
				     aufklappen, nur um zu sehen, wer zahlt und wer mitzahlt.
				     Die beiden liegen in *einem* Container ohne Zwischenraum: zugeklappt
				     sind sie zwei Zeilen, die zusammengehoeren, und jeder Abstand hier
				     wirkt doppelt, weil die Schalter selbst schon 44px hoch sind. -->
				<div class="flex flex-col">
					<div>
						{@render sectionToggle(
							'Bezahlt von',
							nameOf(paidBy) || 'niemand',
							payerOpen,
							() => (payerOpen = !payerOpen)
						)}

						{#if payerOpen}
							<!-- Der Trigger traegt schon ein aria-label, das Label waere eine
							     zweite Beschriftung derselben Sache. -->
							<div class="grid gap-2 pt-1 pb-3">
								<Select.Root type="single" bind:value={payer}>
									<Select.Trigger
										id="expense-payer"
										class="h-11 w-full data-[size=default]:h-11"
										aria-label="Bezahlt von"
									>
										{nameOf(paidBy) || 'Wer hat bezahlt?'}
									</Select.Trigger>
									<Select.Content>
										{#each residents as user (user.id)}
											{@const label = userLabel(user)}
											<Select.Item value={user.id} {label}>{label}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
								<p class="text-muted-foreground px-1 text-xs">
									Diese Person bekommt das Geld von den anderen zurück.
								</p>
							</div>
						{/if}
					</div>

					<div class="grid gap-2">
						{@render sectionToggle(
							'Aufteilen auf',
							picked.length === 1 ? '1 Person' : `${picked.length} Personen`,
							splitOpen,
							() => (splitOpen = !splitOpen)
						)}

						{#if splitOpen}
							<div class="grid gap-2 pt-1 pb-3">
								<div class="flex items-center justify-end gap-1">
									<Button
										type="button"
										variant="ghost"
										size="sm"
										class="h-11"
										onclick={() => (picked = residents.map((u) => u.id))}
									>
										Alle
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										class="h-11"
										onclick={() => (picked = [])}
									>
										Keine
									</Button>
								</div>

								{#if usersLoading}
									<p class="text-muted-foreground py-2 text-sm">Lade …</p>
								{:else if usersFailed}
									<div class="flex flex-col items-start gap-2 py-2">
										<p class="text-muted-foreground text-sm">Die Bewohner sind nicht angekommen.</p>
										<Button
											type="button"
											variant="outline"
											size="lg"
											class="h-11"
											onclick={() => attempt++}
										>
											<RefreshCwIcon class="size-4" />
											Erneut laden
										</Button>
									</div>
								{:else if residents.length === 0}
									<p class="text-muted-foreground py-2 text-sm">Keine Accounts gefunden.</p>
								{:else}
									<ul class="divide-y rounded-lg border">
										{#each residents as user (user.id)}
											{@const label = userLabel(user)}
											{@const photo = avatarUrl(user)}
											{@const on = picked.includes(user.id)}
											{@const share = preview.get(user.id)}
											<li class="flex items-center gap-3 px-3">
												<!-- Die Checkbox traegt den zugaenglichen Namen; der Rest der
												     Zeile ist nur Trefferflaeche fuer den Daumen (siehe
												     docs/pitfalls/designsystem.md). -->
												<Checkbox
													checked={on}
													onCheckedChange={() => togglePicked(user.id)}
													aria-label={label}
												/>
												<button
													type="button"
													class="flex min-w-0 flex-1 items-center gap-2 py-3 text-left"
													tabindex="-1"
													aria-hidden="true"
													onclick={() => togglePicked(user.id)}
												>
													<Avatar.Root class="size-7 shrink-0">
														{#if photo}
															<Avatar.Image src={photo} alt="" />
														{/if}
														<Avatar.Fallback class="text-xs">
															{(label || '?').charAt(0).toUpperCase()}
														</Avatar.Fallback>
													</Avatar.Root>
													<span class="min-w-0 flex-1 truncate text-sm">{label}</span>
													<!-- `!== undefined`, nicht truthy: ein Anteil von 0 Cent ist
													     ein Ergebnis und soll wie in der Liste unten dastehen. -->
													{#if on && share !== undefined}
														<span class="text-muted-foreground shrink-0 text-xs tabular-nums">
															{formatEuro(share)}
														</span>
													{/if}
												</button>
											</li>
										{/each}
									</ul>
								{/if}
							</div>
						{/if}

						<!-- Auch zugeklappt: ein unbrauchbarer Zustand faellt sonst nirgends
						     auf. Im guten Fall rendert das Snippet nichts, die zwei Zeilen
						     bleiben also so kompakt, wie sie aussehen. -->
						{@render splitWarning()}
					</div>
				</div>
			</Card.Content>

			<Card.Footer>
				<Button type="submit" size="lg" class="h-11 w-full" disabled={!valid || posting}>
					{posting ? 'Trage ein …' : 'Ausgabe eintragen'}
				</Button>
			</Card.Footer>
		</form>
	</Card.Root>

	<!-- ------------------------------------------------------------ Salden -->
	{#if !expenses.loading && saldi.length > 0}
		<div>
			<p class="text-muted-foreground mb-1.5 px-1 text-xs font-medium tracking-wide uppercase">
				Salden
			</p>
			<ul class="bg-card divide-y overflow-hidden rounded-lg border">
				{#each saldi as row (row.id)}
					{@const label = nameOf(row.id)}
					{@const photo = avatarUrl(people.get(row.id))}
					<li class="flex items-center gap-3 px-3 py-3">
						<Avatar.Root class="shrink-0">
							{#if photo}
								<Avatar.Image src={photo} alt="" />
							{/if}
							<Avatar.Fallback class="text-xs">
								{label.charAt(0).toUpperCase()}
							</Avatar.Fallback>
						</Avatar.Root>
						<div class="flex min-w-0 flex-1 items-center gap-2">
							<span class="truncate">{label}</span>
							{#if row.id === auth.user?.id}
								<Badge variant="secondary" class="shrink-0">du</Badge>
							{/if}
						</div>
						<!-- Das Vorzeichen steht als Wort da, nicht nur als Farbe. Rot fuer
						     Schulden kommt dazu (`destructive` ist ein Palettenwert), ein
						     Gegenstueck fuer Guthaben nicht: Gruen waere im neutralen
						     Designsystem der einzige Fremdfarbwert. -->
						{#if row.cents > 0}
							<span class="shrink-0 text-sm font-medium tabular-nums">
								bekommt {formatEuro(row.cents)}
							</span>
						{:else if row.cents < 0}
							<span class="text-destructive shrink-0 text-sm font-medium tabular-nums">
								schuldet {formatEuro(-row.cents)}
							</span>
						{:else}
							<span class="text-muted-foreground shrink-0 text-sm">ausgeglichen</span>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- ------------------------------------------------------ Wer wem was -->
	{#if settlement.debts.length > 0}
		<div>
			<!-- Zugeklappt, wie die Warengruppen auf der Liste: dieselbe Aussage steht
			     schon in den Salden, hier nur nach Paaren aufgeschluesselt. -->
			<h2>
				<button
					type="button"
					class="text-muted-foreground focus-visible:ring-ring/50 flex h-11 w-full items-center gap-1.5 rounded-md px-1 text-left text-xs font-medium tracking-wide uppercase outline-none focus-visible:ring-[3px]"
					aria-expanded={debtsOpen}
					onclick={() => (debtsOpen = !debtsOpen)}
				>
					{#if debtsOpen}
						<ChevronDownIcon class="size-4 shrink-0" />
					{:else}
						<ChevronRightIcon class="size-4 shrink-0" />
					{/if}
					<span class="truncate">Wer wem was schuldet</span>
					<span class="shrink-0 normal-case">({settlement.debts.length})</span>
				</button>
			</h2>

			{#if debtsOpen}
				<ul class="bg-card divide-y overflow-hidden rounded-lg border">
					{#each settlement.debts as debt (debt.from + debt.to)}
						<li class="flex items-center gap-2 px-3 py-3">
							<span class="min-w-0 flex-1 truncate text-sm">{nameOf(debt.from)}</span>
							<ArrowRightIcon class="text-muted-foreground size-4 shrink-0" />
							<span class="min-w-0 flex-1 truncate text-sm">{nameOf(debt.to)}</span>
							<span class="shrink-0 text-sm font-medium tabular-nums">
								{formatEuro(debt.cents)}
							</span>
						</li>
					{/each}
				</ul>
				<!-- Die Richtung muss dastehen: wer Zahler und Empfaenger vertauscht,
				     *verdoppelt* die Schuld, statt sie zu tilgen -- und das sieht in der
				     Liste aus wie ein erledigter Ausgleich. -->
				<p class="text-muted-foreground mt-1.5 px-1 text-xs">
					Beglichen? Als Ausgabe eintragen: „Bezahlt von" ist, wer das Geld gegeben hat,
					aufgeteilt wird nur auf die Person, die es bekommen hat.
				</p>
			{/if}
		</div>
	{/if}

	<!-- ----------------------------------------------------------- Ausgaben -->
	<div>
		<p class="text-muted-foreground mb-1.5 px-1 text-xs font-medium tracking-wide uppercase">
			Ausgaben
		</p>
		{#if expenses.loading}
			<p class="text-muted-foreground py-12 text-center text-sm">Lade …</p>
		{:else if expenses.items.length === 0}
			<p class="text-muted-foreground py-12 text-center text-sm">
				Noch keine Ausgaben eingetragen.
			</p>
		{:else}
			<!-- Neuste zuerst; die Reihenfolge kommt aus dem Store (sort '-created'). -->
			<ul class="bg-card divide-y overflow-hidden rounded-lg border">
				{#each expenses.items as expense (expense.id)}
					{@const counts = countsIn(expense)}
					{@const shares = splitShares(expense.amount_cents, expense.shared_with, expense.id)}
					<li class="flex items-start gap-2 py-3 pr-1 pl-3">
						<div class="min-w-0 flex-1">
							<div class="flex items-baseline gap-2">
								<span class="min-w-0 flex-1 truncate font-medium">{expense.title}</span>
								<span class="shrink-0 font-medium tabular-nums">
									{formatEuro(expense.amount_cents)}
								</span>
							</div>
							<span class="text-muted-foreground block truncate text-xs">
								{metaFor(expense)}
							</span>
							<!-- Die Anteile nur zeigen, wenn sie auch zaehlen: `countsIn` ist
							     dieselbe Bedingung, an der die Auswertung eine Ausgabe
							     ueberspringt (fehlender Zahler nach einer Account-Loeschung).
							     Sonst stuenden hier Betraege, die in keinem Saldo vorkommen. -->
							{#if counts}
								<!-- Einzeln, weil bei einem Restcent nicht alle denselben
								     Betrag bekommen -- und das soll man sehen. -->
								<div class="mt-1 flex flex-wrap gap-1">
									{#each [...shares] as [id, cents] (id)}
										<Badge variant="outline" class="font-normal tabular-nums">
											{nameOf(id)}
											{formatEuro(cents)}
										</Badge>
									{/each}
								</div>
							{:else}
								<span class="text-muted-foreground block text-xs">
									Nicht aufgeteilt — zählt in keinem Saldo mit.
								</span>
							{/if}
						</div>
						<Button
							variant="ghost"
							size="icon"
							class="text-muted-foreground size-11 shrink-0"
							aria-label={`„${expense.title}“ löschen`}
							onclick={() => askDelete(expense)}
						>
							<Trash2Icon class="size-4" />
						</Button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</main>

<AlertDialog.Root bind:open={confirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Ausgabe löschen?</AlertDialog.Title>
			<AlertDialog.Description>
				Verschiebt die Salden aller Beteiligten. Das lässt sich nicht zurücknehmen.
			</AlertDialog.Description>
		</AlertDialog.Header>

		{#if pending}
			<p class="text-muted-foreground text-xs">
				{pending.title} · {formatEuro(pending.amount_cents)}
			</p>
		{/if}

		<AlertDialog.Footer>
			<AlertDialog.Cancel class="h-11">Abbrechen</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" class="h-11" onclick={confirmDelete}>
				Löschen
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
