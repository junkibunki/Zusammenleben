/// <reference path="../pb_data/types.d.ts" />

// Ausgaben: Zahler und Teilnehmer muessen zum Haushalt der Ausgabe gehoeren.
//
// Die Rules pruefen nur, dass der *Eintragende* Mitglied ist
// (Migration 1789304400). `paid_by` und `shared_with` kommen dagegen frei aus
// dem Request -- ohne diese Pruefung liesse sich jemandem aus einem anderen
// Haushalt eine Schuld zuschreiben, die er nie zu sehen bekommt.
//
// Beim Update genauso: die UpdateRule laesst `paid_by`/`shared_with` sonst frei.
// `e.record` traegt dort schon die neuen Werte; geprueft wird nur, wer *neu*
// dazukommt -- eine alte Ausgabe mit einem inzwischen abgelaufenen Gast soll
// sich weiter bearbeiten lassen.
//
// Ausnahme: ein *ehemaliges* Mitglied (abgelaufene Zeile in `memberships`)
// darf in einem Ausgleich stehen -- sonst bliebe eine offene Schuld mit einem
// ausgetragenen Gast fuer immer stehen. Ausgleich heisst: ein Zahler, genau ein
// Teilnehmer, positiver Betrag, und der Zahler schuldet dem Teilnehmer nach
// dem Schuldbuch des Haushalts mindestens so viel. Damit kann ein neuer
// Eintrag eine Paarschuld nur verkleinern, nie eine neue anlegen. (Beim Update
// gilt wie bisher `known`: wer schon im Eintrag stand, wird nicht geprueft.) Gerechnet wird wie in
// `computeSettlement()` (frontend/src/lib/expenses.svelte.js), Restcent
// inklusive -- weicht das eine ab, lehnt der Server Ausgleiche ab, die die Seite
// anbietet.
//
// Alles in *einem* Callback: PocketBase fuehrt ihn in einer eigenen JS-VM aus,
// die den Modulscope dieser Datei nicht kennt.
const checkMembers = (e) => {
	const household = e.record.getString('household');

	const hasMembership = (userId, filter) => {
		try {
			e.app.findFirstRecordByFilter('memberships', filter, { u: userId, h: household });
			return true;
		} catch (err) {
			// findFirstRecordByFilter wirft bei keinem Treffer, statt null zu liefern.
			return false;
		}
	};
	const isMember = (userId) =>
		hasMembership(userId, 'user = {:u} && household = {:h} && (until = "" || until > @now)');
	const wasMember = (userId) => hasMembership(userId, 'user = {:u} && household = {:h}');

	const fail = (field, message, code) => {
		const errors = {};
		errors[field] = new ValidationError(code || 'expense_not_member', message);
		throw new BadRequestError(message, errors);
	};

	// Wie splitShares() im Frontend: Anteile in Cent, Restcent ab einem aus der
	// Expense-ID abgeleiteten Startpunkt, Erstattungen negativ.
	const splitShares = (amountCents, memberIds, seed) => {
		const shares = {};
		const ids = [];
		for (let i = 0; i < memberIds.length; i++) {
			if (memberIds[i] && ids.indexOf(memberIds[i]) === -1) ids.push(memberIds[i]);
		}
		if (!ids.length || !amountCents) return shares;
		const sign = amountCents < 0 ? -1 : 1;
		const total = Math.abs(amountCents);
		const base = Math.floor(total / ids.length);
		const rest = total - base * ids.length;
		for (let i = 0; i < ids.length; i++) shares[ids[i]] = base;
		const order = ids.slice().sort();
		const text = String(seed);
		let offset = 0;
		for (let i = 0; i < text.length; i++) offset = (offset * 31 + text.charCodeAt(i)) % ids.length;
		for (let i = 0; i < rest; i++) shares[order[(offset + i) % ids.length]] += 1;
		if (sign === -1) for (const id in shares) shares[id] = -shares[id];
		return shares;
	};

	// Wie viel `from` an `to` schuldet (negativ: umgekehrt), ohne diesen Record.
	const pairDebt = (from, to) => {
		const rows = e.app.findRecordsByFilter('expenses', 'household = {:h}', '', 0, 0, { h: household });
		let net = 0;
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			if (row.id === e.record.id) continue;
			const paidBy = row.getString('paid_by');
			const shared = row.getStringSlice('shared_with');
			if (!paidBy || !shared.length) continue;
			const shares = splitShares(row.getInt('amount_cents'), shared, row.id);
			for (const id in shares) {
				const cents = shares[id];
				if (id === paidBy || cents === 0) continue;
				const debtor = cents > 0 ? id : paidBy;
				const creditor = cents > 0 ? paidBy : id;
				if (debtor === from && creditor === to) net += Math.abs(cents);
				else if (debtor === to && creditor === from) net -= Math.abs(cents);
			}
		}
		return net;
	};

	// Beim Create gibt es keinen Vorzustand, `original()` ist dann leer.
	const before = e.record.original();
	const had = [before.getString('paid_by')].concat(before.get('shared_with') || []);
	const known = (userId) => had.indexOf(userId) !== -1;

	const payer = e.record.getString('paid_by');
	const members = e.record.get('shared_with') || [];

	// Wer neu dazukommt und nicht laufend Mitglied ist: ehemalige Mitglieder
	// sammeln (fuer den Ausgleich), alle anderen sofort abweisen.
	let former = false;
	if (payer && !known(payer) && !isMember(payer)) {
		if (!wasMember(payer)) fail('paid_by', 'Wer bezahlt hat, gehört nicht zu diesem Haushalt.');
		former = true;
	}
	for (let i = 0; i < members.length; i++) {
		if (!known(members[i]) && !isMember(members[i])) {
			if (!wasMember(members[i])) {
				fail('shared_with', 'Jemand in der Aufteilung gehört nicht zu diesem Haushalt.');
			}
			former = true;
		}
	}

	if (former) {
		const message = 'Mit ehemaligen Mitgliedern lässt sich nur eine offene Schuld ausgleichen.';
		const amount = e.record.getInt('amount_cents');
		if (members.length !== 1 || members[0] === payer || amount <= 0) {
			fail('shared_with', message);
		}
		if (pairDebt(payer, members[0]) < amount) {
			fail('amount_cents', 'Der Ausgleich ist höher als die offene Schuld.', 'expense_settle_exceeds');
		}
	}

	e.next();
};
onRecordCreateRequest(checkMembers, 'expenses');
onRecordUpdateRequest(checkMembers, 'expenses');
