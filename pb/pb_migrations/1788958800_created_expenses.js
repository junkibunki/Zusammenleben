/// <reference path="../pb_data/types.d.ts" />

// Collection "expenses" -- gemeinsame Ausgaben, die auf die Bewohner aufgeteilt
// werden. API-Rules wie bei `items`: wer eingeloggt ist, darf alles. Loeschen
// bleibt offen, weil ein Tippfehler im Betrag sonst dauerhaft alle Salden
// verschiebt -- anders als bei `ideas`, wo Abhaken der vorgesehene Abschluss ist.
//
// `amount_cents` statt Euro als Kommazahl: geteilt wird in ganzen Cent, und
// eine Summe, die aus 0.1 + 0.2 entstanden ist, waere nie wieder exakt.
//
// `shared_with` haelt fest, wer beim Eintragen ausgewaehlt war -- ein spaeter
// angelegter Account aendert alte Ausgaben also nicht. Ganz eingefroren ist die
// Aufteilung damit aber nicht: die Anteile werden bei jeder Anzeige aus dieser
// Liste neu gerechnet, und beim Loeschen eines Accounts nimmt PocketBase dessen
// ID hier heraus -- der Betrag verteilt sich danach still auf die Verbleibenden.
// Fest waeren nur gespeicherte Anteile; das ist bewusst nicht gebaut, weil in
// dieser App keine Accounts geloescht werden (die Registrierung ist zu).
//
// Alle drei Relations sind `required: false` und `cascadeDelete: false`: ein
// geloeschter Account soll die Ausgabe nicht mitnehmen (und ein `required`
// wuerde das Loeschen des Accounts blockieren). Gesetzt werden sie vom Client;
// eine Ausgabe ohne Zahler zaehlt in der Auswertung nicht mit.
migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		const loggedIn = '@request.auth.id != ""';

		const collection = new Collection({
			type: 'base',
			name: 'expenses',
			listRule: loggedIn,
			viewRule: loggedIn,
			createRule: loggedIn,
			updateRule: loggedIn,
			deleteRule: loggedIn,
			fields: [
				{
					name: 'id',
					type: 'text',
					system: true,
					primaryKey: true,
					required: true,
					min: 15,
					max: 15,
					pattern: '^[a-z0-9]+$',
					autogeneratePattern: '[a-z0-9]{15}'
				},
				{ name: 'title', type: 'text', required: true, max: 120 },
				{
					name: 'amount_cents',
					type: 'number',
					required: true,
					onlyInt: true,
					min: 1,
					// 10.000 EUR. Nicht gegen Missbrauch, sondern gegen die verrutschte
					// Kommastelle: ein Tippfehler verschiebt sonst still alle Salden.
					max: 1000000
				},
				{
					name: 'paid_by',
					type: 'relation',
					required: false,
					collectionId: users.id,
					cascadeDelete: false,
					maxSelect: 1
				},
				{
					// maxSelect > 1 macht das Feld mehrwertig.
					name: 'shared_with',
					type: 'relation',
					required: false,
					collectionId: users.id,
					cascadeDelete: false,
					maxSelect: 50
				},
				{
					// Wer den Eintrag angelegt hat -- nicht zwingend der Zahler. Steht in
					// der Anzeige nur dann dabei, wenn beide sich unterscheiden, und geht
					// in keine Rechnung ein.
					name: 'created_by',
					type: 'relation',
					required: false,
					collectionId: users.id,
					cascadeDelete: false,
					maxSelect: 1
				},
				{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
				{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
			],
			// Die Liste sortiert nach `created` absteigend.
			indexes: ['CREATE INDEX `idx_expenses_created` ON `expenses` (`created`)']
		});

		app.save(collection);
	},
	(app) => {
		app.delete(app.findCollectionByNameOrId('expenses'));
	}
);
