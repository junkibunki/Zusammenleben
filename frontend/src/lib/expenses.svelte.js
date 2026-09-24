import { pb } from './pocketbase.svelte.js';
import { households } from './households.svelte.js';

// Gemeinsame Ausgaben. Collection aus Migration 1788958800.
const COLLECTION = 'expenses';

// Ohne expand stehen in den Relations nur Record-IDs statt Namen.
const EXPAND = 'paid_by,shared_with,created_by';

/** Maximale Laenge der Bezeichnung -- muss mit der Migration uebereinstimmen. */
export const TITLE_MAX = 120;

/**
 * Obergrenze fuer den *Betrag* eines Eintrags (10.000 €), ebenfalls in der
 * Migration. Nicht als Schutz vor Missbrauch gedacht, sondern gegen die
 * verrutschte Kommastelle: ein Tippfehler verschiebt sonst still alle Salden.
 *
 * Gilt in beide Richtungen: erlaubt ist -10.000 € … -0,01 € und
 * 0,01 € … 10.000 €. Ein negativer Betrag ist eine Erstattung -- der Zahler
 * hat Geld *bekommen* und gibt es an die Teilnehmer ab. Genau 0 ist keins von
 * beidem und bleibt gesperrt (Migration 1789218000).
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
// Haelt den Haushalt, dessen Ausgaben zuletzt geladen wurden.
let loadedFor = '';

/**
 * Laedt die Ausgaben (neuste zuerst) und haengt die Realtime-Subscription an.
 * Aufruf aus einem $effect heraus; der Rueckgabewert ist das Teardown.
 */
export function syncExpenses(householdId) {
	let cancelled = false;
	// Nur beim ersten Laden "Lade …": beim Zurueckkehren steht die Liste noch da.
	// Nach einem Wechsel des Haushalts gehoert sie nicht mehr hierher -- und
	// zaehlte sonst bis zum Laden in fremden Salden mit.
	if (loadedFor !== householdId) expenses.items = [];
	expenses.loading = loadedFor !== householdId;
	expenses.error = null;
	const filter = pb.filter('household = {:h}', { h: householdId });

	pb.collection(COLLECTION)
		.getFullList({ sort: '-created', expand: EXPAND, filter })
		.then((records) => {
			if (cancelled) return;
			expenses.items = records;
			expenses.loading = false;
			loadedFor = householdId;
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
			if (e.record.household !== householdId) return;
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
		{ expand: EXPAND, filter }
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
	// 0 ist hier kein fehlender Betrag, sondern ein sinnloser -- er verschiebt
	// keinen Saldo. Die Meldung trennt das nicht, weil das Feld dafuer keinen
	// Unterschied macht: beides heisst "trag eine Zahl ein".
	if (!Number.isInteger(amountCents) || amountCents === 0) throw userError('Der Betrag fehlt.');
	if (Math.abs(amountCents) > AMOUNT_MAX_CENTS) throw userError('Der Betrag ist zu groß.');
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
				created_by: pb.authStore.record?.id ?? '',
				household: households.activeId
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

/**
 * Eine Schuld als beglichen eintragen: eine Ausgabe, die der Schuldner bezahlt
 * und die nur auf den Glaeubiger geteilt wird. Das hebt in `computeSettlement`
 * genau diese Paarschuld auf. Das Geld selbst fliesst ausserhalb der App.
 *
 * `from` ist in der Praxis der eigene Account -- die Seite bietet es nur fuer
 * die eigenen Schulden an.
 *
 * `id` wie bei `addExpense`: ein zweiter Versuch nach verlorener Antwort soll
 * denselben Eintrag treffen, nicht einen zweiten Ausgleich anlegen.
 *
 * Ein Eintrag hat hoechstens `AMOUNT_MAX_CENTS`, eine Paarschuld ist dagegen
 * eine Summe ohne Obergrenze. Darueber hinaus wird deshalb nur bis zur Grenze
 * beglichen; der Rest bleibt stehen und laesst sich erneut begleichen.
 *
 * @returns wie `addExpense`
 */
export async function settleDebt({ id, from, to, cents, toName }) {
	if (!from || !to || from === to) throw userError('Diese Schuld lässt sich nicht begleichen.');
	try {
		return await addExpense({
			id,
			title: `Ausgleich an ${toName || 'Jemand'}`.slice(0, TITLE_MAX),
			amountCents: Math.min(cents, AMOUNT_MAX_CENTS),
			paidBy: from,
			sharedWith: [to]
		});
	} catch (err) {
		// Der Hook (expenses.pb.js) laesst nur aktuelle Mitglieder in die
		// Aufteilung -- ein Gast, dessen Zeit abgelaufen ist, faellt hier heraus.
		if (err?.response?.data?.shared_with?.code === 'expense_not_member') {
			throw userError(
				`${toName || 'Diese Person'} gehört nicht mehr zum Haushalt — der Ausgleich lässt sich nicht eintragen.`
			);
		}
		throw err;
	}
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
 * Ein negativer Betrag (Erstattung) ergibt negative Anteile. Gerechnet wird
 * dafuer mit dem Betrag ohne Vorzeichen und erst am Ende negiert -- `Math.floor`
 * rundet sonst nach *unten* statt zum Nullpunkt, und der "Rest" waere negativ.
 *
 * @returns {Map<string, number>} User-ID -> Anteil in Cent
 */
export function splitShares(amountCents, memberIds, seed = '') {
	const shares = new Map();
	const ids = [...new Set((memberIds ?? []).filter(Boolean))];
	if (!ids.length || !Number.isFinite(amountCents) || amountCents === 0) return shares;

	const sign = amountCents < 0 ? -1 : 1;
	const total = Math.abs(amountCents);
	const base = Math.floor(total / ids.length);
	const rest = total - base * ids.length;
	for (const id of ids) shares.set(id, base);

	const order = [...ids].sort();
	let offset = 0;
	for (const ch of String(seed)) offset = (offset * 31 + ch.charCodeAt(0)) % ids.length;
	for (let i = 0; i < rest; i++) {
		const id = order[(offset + i) % ids.length];
		shares.set(id, shares.get(id) + 1);
	}

	if (sign === -1) for (const [id, cents] of shares) shares.set(id, -cents);
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
			if (id === e.paid_by || cents === 0) continue;

			// Bei einer Erstattung (negativer Anteil) dreht sich die Richtung um:
			// der Zahler hat das Geld bekommen und schuldet es den Teilnehmern.
			// Ein `cents < 0` einfach zu ueberspringen hiesse, die Erstattung
			// stillschweigend zu verschlucken.
			const debtor = cents > 0 ? id : e.paid_by;
			const creditor = cents > 0 ? e.paid_by : id;

			const row = owed.get(debtor) ?? new Map();
			row.set(creditor, (row.get(creditor) ?? 0) + Math.abs(cents));
			owed.set(debtor, row);
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
 * ist (auch bei mehr als `AMOUNT_MAX_CENTS` und bei genau 0).
 *
 * Nimmt Komma *und* Punkt: das Feld ist `inputmode="decimal"`, und welches
 * Zeichen die Tastatur dort anbietet, entscheidet das Geraet, nicht die App.
 * Aus demselben Grund gilt neben dem Bindestrich auch das typografische Minus
 * und der Gedankenstrich als Vorzeichen -- iOS ersetzt beim Tippen gern.
 */
export function parseAmount(text) {
	const cleaned = (text ?? '')
		.replace(/[\s€]/g, '')
		.replace(/[−–—]/g, '-')
		.replace(',', '.');
	if (!/^-?\d{1,9}(\.\d{1,2})?$/.test(cleaned)) return null;

	// Ueber die Cent-Zahl runden: parseFloat('0.29') * 100 ist 28.999999999999996.
	const cents = Math.round(Number(cleaned) * 100);
	// `cents !== 0` faengt auch "-0,00" ab: -0 === 0 ist in JS wahr.
	return cents !== 0 && Math.abs(cents) <= AMOUNT_MAX_CENTS ? cents : null;
}
