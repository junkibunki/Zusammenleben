import { pb } from './pocketbase.svelte.js';

// Gemeinsame Ausgaben. Collection aus Migration 1788958800.
const COLLECTION = 'expenses';

// Ohne expand stehen in den Relations nur Record-IDs statt Namen.
const EXPAND = 'paid_by,shared_with,created_by';

/** Maximale Laenge der Bezeichnung -- muss mit der Migration uebereinstimmen. */
export const TITLE_MAX = 120;

/**
 * Obergrenze fuer einen Betrag (10.000 €), ebenfalls in der Migration.
 * Nicht als Schutz vor Missbrauch gedacht, sondern gegen die verrutschte
 * Kommastelle: ein Tippfehler verschiebt sonst still alle Salden.
 */
export const AMOUNT_MAX_CENTS = 1000000;

/** Hoechstzahl der Teilnehmer -- muss mit `maxSelect` in der Migration uebereinstimmen. */
export const MEMBERS_MAX = 50;

export const expenses = $state({
	items: [],
	loading: true,
	error: null
});

// Bewusst *kein* $state: syncExpenses() laeuft in einem $effect, und ein
// reaktiver Lesezugriff dort haengt den Effekt an das, was sein eigener
// Ladevorgang anschliessend schreibt -- Endlosschleife (CLAUDE.md).
let loadedOnce = false;

/**
 * Laedt die Ausgaben (neuste zuerst) und haengt die Realtime-Subscription an.
 * Aufruf aus einem $effect heraus; der Rueckgabewert ist das Teardown.
 */
export function syncExpenses() {
	let cancelled = false;
	// Nur beim ersten Laden "Lade …": beim Zurueckkehren steht die Liste noch da.
	expenses.loading = !loadedOnce;
	expenses.error = null;

	pb.collection(COLLECTION)
		.getFullList({ sort: '-created', expand: EXPAND })
		.then((records) => {
			if (cancelled) return;
			expenses.items = records;
			expenses.loading = false;
			loadedOnce = true;
		})
		.catch(() => {
			if (cancelled) return;
			// PocketBase antwortet englisch und ohne Bezug zur Seite.
			expenses.error = 'Die Ausgaben konnten nicht geladen werden.';
			expenses.loading = false;
		});

	// Das expand gehoert als drittes Argument dazu, sonst fehlen die Namen
	// genau bei den Eintraegen, die ueber Realtime hereinkommen.
	pb.collection(COLLECTION).subscribe(
		'*',
		(e) => {
			const items = expenses.items;
			const idx = items.findIndex((x) => x.id === e.record.id);

			if (e.action === 'create') {
				// idx > -1 heisst: lokal schon optimistisch eingefuegt.
				if (idx === -1) items.unshift(e.record); // neuste zuerst
				else items[idx] = e.record;
			} else if (e.action === 'update') {
				if (idx > -1) items[idx] = e.record;
				else items.unshift(e.record);
			} else if (e.action === 'delete') {
				if (idx > -1) items.splice(idx, 1);
			}
		},
		{ expand: EXPAND }
	);

	return () => {
		cancelled = true;
		pb.collection(COLLECTION).unsubscribe('*');
	};
}

/**
 * Eine Record-ID im Format, das PocketBase selbst vergibt (15 Zeichen a-z0-9).
 *
 * Die ID wird *vor* dem Speichern gebraucht, weil sie in `splitShares` den
 * Restcent verteilt: ohne sie zeigte die Vorschau im Formular eine andere
 * Aufteilung als der gespeicherte Eintrag.
 *
 * Format wie das `id`-Feld der Migration (15 Zeichen a-z0-9, entspricht ihrem
 * `autogeneratePattern`) -- weicht das eine ab, antwortet PocketBase mit 400.
 */
export function newExpenseId() {
	const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	let out = '';
	for (const b of bytes) out += alphabet[b % alphabet.length];
	return out;
}

/**
 * Ein Fehler, dessen Text der Nutzer sehen soll. Alles ohne diese Markierung
 * ersetzt die Seite durch eine eigene Meldung -- PocketBase antwortet englisch
 * und ohne Bezug zur Seite.
 */
function userError(message) {
	const err = new Error(message);
	err.userFacing = true;
	return err;
}

/**
 * Ist der Fehler die Beschwerde, dass es diese ID schon gibt?
 * PocketBase haengt die Feldfehler eines 400ers unter `response.data`; fuer
 * eine belegte ID steht dort `id.code = "validation_not_unique"`.
 * (`err.data` des SDK ist ein Getter auf dasselbe `response` -- ein zweiter
 * Pfad dafuer waere toter Code.)
 */
function isDuplicateId(err) {
	const code = err?.response?.data?.id?.code;
	return typeof code === 'string' && code.includes('not_unique');
}

/** Steht im Record das, was gerade abgeschickt wurde? */
function matches(record, { title, amountCents, paidBy, members }) {
	const a = [...(record?.shared_with ?? [])].sort().join(',');
	const b = [...members].sort().join(',');
	return (
		record?.title === title &&
		record?.amount_cents === amountCents &&
		record?.paid_by === paidBy &&
		a === b
	);
}

/**
 * Neue Ausgabe eintragen. `sharedWith` ist die Auswahl der Bewohner, auf die
 * geteilt wird -- der Server rechnet sie nie nach.
 *
 * Wirft bei einem Fehler weiter; die Seite behaelt dann ihren Entwurf.
 *
 * @returns {Promise<{record: object, mismatch: boolean}>} `mismatch` heisst:
 * die Ausgabe lag unter dieser ID schon auf dem Server, und zwar mit *anderen*
 * Werten als gerade abgeschickt -- das Abgeschickte ist also nicht gespeichert.
 */
export async function addExpense({ id, title, amountCents, paidBy, sharedWith }) {
	const trimmed = (title ?? '').trim();
	if (!trimmed) throw userError('Die Bezeichnung fehlt.');
	if (!Number.isInteger(amountCents) || amountCents < 1) throw userError('Der Betrag fehlt.');
	if (amountCents > AMOUNT_MAX_CENTS) throw userError('Der Betrag ist zu groß.');
	if (!paidBy) throw userError('Es fehlt, wer bezahlt hat.');

	const members = [...new Set((sharedWith ?? []).filter(Boolean))];
	if (!members.length) throw userError('Es ist niemand ausgewählt, der mitzahlt.');
	if (members.length > MEMBERS_MAX) {
		throw userError(`Höchstens ${MEMBERS_MAX} Personen können mitzahlen.`);
	}

	const sent = { title: trimmed, amountCents, paidBy, members };
	const recordId = id || newExpenseId();
	let record;
	let mismatch = false;

	try {
		record = await pb.collection(COLLECTION).create(
			{
				id: recordId,
				title: trimmed,
				amount_cents: amountCents,
				paid_by: paidBy,
				shared_with: members,
				created_by: pb.authStore.record?.id ?? ''
			},
			{ expand: EXPAND }
		);
	} catch (err) {
		// Ging nur die *Antwort* verloren, liegt der Eintrag schon auf dem Server
		// und der zweite Versuch scheitert an der eindeutigen ID. Das ist kein
		// Fehlschlag -- sonst haengt das Formular in einer Meldung fest, waehrend
		// der Eintrag via Realtime laengst in der Liste steht.
		if (!isDuplicateId(err)) throw err;
		record = await pb.collection(COLLECTION).getOne(recordId, { expand: EXPAND });

		// Aber nur, wenn dort auch dasselbe steht. Wer die Fehlermeldung als
		// Einladung liest, den Betrag zu korrigieren und nochmal zu senden, bekaeme
		// sonst "gespeichert" gemeldet, waehrend der alte Betrag stehen bleibt --
		// bei Geld die unangenehmste Sorte falsch. Kein `throw`: der Record ist
		// echt und gehoert in die Liste; die Seite sagt dazu, was nicht ankam.
		mismatch = !matches(record, sent);
	}

	// Der Server schickt denselben Record gleich noch einmal ueber die
	// Subscription -- ohne diesen Check stuende er doppelt in der Liste.
	if (!expenses.items.some((x) => x.id === record.id)) expenses.items.unshift(record);

	return { record, mismatch };
}

/** Ausgabe loeschen. Optimistisch, mit Rollback bei einem Fehler. */
export async function deleteExpense(expense) {
	const items = expenses.items;
	const idx = items.findIndex((x) => x.id === expense.id);
	if (idx === -1) return;

	const [removed] = items.splice(idx, 1);
	try {
		await pb.collection(COLLECTION).delete(expense.id);
	} catch (err) {
		// Ein 404 heisst: weg ist weg (jemand anders war schneller). Zuruecklegen
		// wuerde eine Zeile erzeugen, die es serverseitig nicht mehr gibt -- und
		// die bis zum Reload in jedem Saldo mitzaehlt.
		if (err?.status === 404) return;

		// Ging nur die *Antwort* verloren, ist der Record trotzdem weg. Das ist
		// der Spiegelfall zu `addExpense`, und hier nachzusehen kostet einen
		// Request auf einem Pfad, der ohnehin schiefgegangen ist. Nur wenn auch
		// das Nachsehen scheitert, bleibt es beim Zuruecklegen: eine Zeile, die
		// wieder auftaucht, ist harmloser als eine, die still verschwindet.
		try {
			await pb.collection(COLLECTION).getOne(expense.id);
		} catch (check) {
			if (check?.status === 404) return;
		}

		// Der `some`-Check ist nicht kosmetisch: kam zwischen dem `splice` oben
		// und hier ein Realtime-Event fuer denselben Record, steht er schon wieder
		// in der Liste. Ohne den Check zweimal -- und dann zaehlt
		// `computeSettlement` das Geld doppelt.
		if (!items.some((x) => x.id === removed.id)) items.splice(idx, 0, removed);
		expenses.error = 'Die Ausgabe konnte nicht gelöscht werden.';
	}
}

/* ------------------------------------------------------------------ Rechnen */

/**
 * Teilt `amountCents` in ganzen Cent auf `memberIds` auf. Die Summe der
 * Anteile ist damit *exakt* der Betrag; genau deshalb wird in Cent gerechnet
 * und nicht in Euro als Kommazahl.
 *
 * Den Rest (0 … n-1 Cent) bekommen aufeinanderfolgende Teilnehmer in
 * ID-Reihenfolge, beginnend bei einem aus `seed` (der Expense-ID) abgeleiteten
 * Startpunkt. Ohne diesen Startpunkt zahlte immer dieselbe Person -- die mit
 * der kleinsten ID -- den zusaetzlichen Cent, und das mittelt sich nie aus:
 * drei Ausgaben à 1,00 € auf drei Personen mit wechselnden Zahlern lassen sie
 * am Ende 2 Cent schulden, obwohl alle gleich viel bezahlt haben.
 *
 * Gleicher `seed` heisst gleiches Ergebnis, auf jedem Geraet.
 *
 * @returns {Map<string, number>} User-ID -> Anteil in Cent
 */
export function splitShares(amountCents, memberIds, seed = '') {
	const shares = new Map();
	const ids = [...new Set((memberIds ?? []).filter(Boolean))];
	if (!ids.length || !Number.isFinite(amountCents) || amountCents <= 0) return shares;

	const base = Math.floor(amountCents / ids.length);
	const rest = amountCents - base * ids.length;
	for (const id of ids) shares.set(id, base);

	const order = [...ids].sort();
	let offset = 0;
	for (const ch of String(seed)) offset = (offset * 31 + ch.charCodeAt(0)) % ids.length;
	for (let i = 0; i < rest; i++) {
		const id = order[(offset + i) % ids.length];
		shares.set(id, shares.get(id) + 1);
	}

	return shares;
}

/**
 * Zaehlt eine Ausgabe in der Auswertung mit?
 * Ohne Zahler oder ohne Teilnehmer gibt es nichts zu verrechnen -- der Fall
 * entsteht, wenn ein beteiligter Account geloescht wurde (siehe Migration).
 */
export function countsIn(expense) {
	return Boolean(expense?.paid_by) && (expense?.shared_with?.length ?? 0) > 0;
}

/**
 * Wer schuldet wem was, und wie steht jeder insgesamt da.
 *
 * Beide Antworten kommen aus *einem* Durchlauf ueber dasselbe Schuldbuch
 * (Schuldner -> Glaeubiger -> Cent), koennen sich also nicht widersprechen;
 * die Summe aller Salden ist 0. Der Zahler taucht als Schuldner nie auf --
 * sein eigener Anteil ist mit dem Bezahlen schon abgegolten.
 *
 * `debts` ist paarweise verrechnet und bewusst *nicht* ueber Dritte
 * zusammengelegt ("A zahlt an C statt an B"): jede Zeile laesst sich an den
 * Ausgaben zwischen genau diesen zwei Personen nachvollziehen.
 *
 * @returns {{
 *   debts: {from: string, to: string, cents: number}[],
 *   balances: Map<string, number>
 * }} `balances`: positiv = bekommt noch, negativ = schuldet noch.
 */
export function computeSettlement(items) {
	/** @type {Map<string, Map<string, number>>} Schuldner -> Glaeubiger -> Cent */
	const owed = new Map();

	for (const e of items ?? []) {
		if (!countsIn(e)) continue;
		for (const [id, cents] of splitShares(e.amount_cents, e.shared_with, e.id)) {
			if (id === e.paid_by || cents <= 0) continue;
			const row = owed.get(id) ?? new Map();
			row.set(e.paid_by, (row.get(e.paid_by) ?? 0) + cents);
			owed.set(id, row);
		}
	}

	const balances = new Map();
	const add = (id, cents) => balances.set(id, (balances.get(id) ?? 0) + cents);
	const debts = [];
	const done = new Set();

	for (const [a, row] of owed) {
		for (const [b, cents] of row) {
			add(a, -cents);
			add(b, cents);

			const key = a < b ? `${a}|${b}` : `${b}|${a}`;
			if (done.has(key)) continue;
			done.add(key);

			const net = (owed.get(a)?.get(b) ?? 0) - (owed.get(b)?.get(a) ?? 0);
			if (net > 0) debts.push({ from: a, to: b, cents: net });
			else if (net < 0) debts.push({ from: b, to: a, cents: -net });
		}
	}

	debts.sort((x, y) => y.cents - x.cents);
	return { debts, balances };
}

/* ------------------------------------------------------------------- Format */

/** "12,50 €" -- `cents` ist eine ganze Zahl. */
export function formatEuro(cents) {
	return ((cents ?? 0) / 100).toLocaleString('de-DE', {
		style: 'currency',
		currency: 'EUR'
	});
}

/**
 * Eingabe im Betragsfeld -> Cent, oder `null` wenn das keine brauchbare Zahl
 * ist (auch bei mehr als `AMOUNT_MAX_CENTS`).
 * Nimmt Komma *und* Punkt: das Feld ist `inputmode="decimal"`, und welches
 * Zeichen die Tastatur dort anbietet, entscheidet das Geraet, nicht die App.
 */
export function parseAmount(text) {
	const cleaned = (text ?? '').replace(/[\s€]/g, '').replace(',', '.');
	if (!/^\d{1,9}(\.\d{1,2})?$/.test(cleaned)) return null;

	// Ueber die Cent-Zahl runden: parseFloat('0.29') * 100 ist 28.999999999999996.
	const cents = Math.round(Number(cleaned) * 100);
	return cents >= 1 && cents <= AMOUNT_MAX_CENTS ? cents : null;
}
