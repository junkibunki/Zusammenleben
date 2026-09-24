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
// Alles in *einem* Callback: PocketBase fuehrt ihn in einer eigenen JS-VM aus,
// die den Modulscope dieser Datei nicht kennt.
const checkMembers = (e) => {
	const household = e.record.getString('household');

	const isMember = (userId) => {
		try {
			e.app.findFirstRecordByFilter(
				'memberships',
				'user = {:u} && household = {:h} && (until = "" || until > @now)',
				{ u: userId, h: household }
			);
			return true;
		} catch (err) {
			// findFirstRecordByFilter wirft bei keinem Treffer, statt null zu liefern.
			return false;
		}
	};

	const fail = (field, message) => {
		const errors = {};
		errors[field] = new ValidationError('expense_not_member', message);
		throw new BadRequestError(message, errors);
	};

	// Beim Create gibt es keinen Vorzustand, `original()` ist dann leer.
	const before = e.record.original();
	const had = [before.getString('paid_by')].concat(before.get('shared_with') || []);
	const known = (userId) => had.indexOf(userId) !== -1;

	const payer = e.record.getString('paid_by');
	if (payer && !known(payer) && !isMember(payer)) fail('paid_by', 'Wer bezahlt hat, gehört nicht zu diesem Haushalt.');

	const members = e.record.get('shared_with') || [];
	for (let i = 0; i < members.length; i++) {
		if (!known(members[i]) && !isMember(members[i])) {
			fail('shared_with', 'Jemand in der Aufteilung gehört nicht zu diesem Haushalt.');
		}
	}

	e.next();
};
onRecordCreateRequest(checkMembers, 'expenses');
onRecordUpdateRequest(checkMembers, 'expenses');
