/// <reference path="../pb_data/types.d.ts" />

// Negative Betraege in "expenses" erlauben -- Erstattungen.
//
// Eine Rueckzahlung (Pfand, stornierte Bestellung, Anteil einer Kaution) gehoert
// in dieselbe Rechnung wie die Ausgabe, nur mit umgedrehter Richtung: der
// Zahler hat das Geld *bekommen* und gibt es an die Teilnehmer ab. Bisher
// verbot `min: 1` das; die Alternative waere eine zweite Collection gewesen, die
// dieselben Salden nochmal von der anderen Seite fuehrt.
//
// Genau 0 bleibt gesperrt. Das kann das Feld selbst nicht ausdruecken (min/max
// ist ein Intervall), also uebernimmt es die CreateRule. Nur die CreateRule:
// `@request.body.amount_cents` steht bei einem Teil-Update nicht im Body, und
// ein Vergleich gegen NULL wuerde dort jede Aenderung abweisen. Ueber die
// Oberflaeche wird eine Ausgabe ohnehin nie geaendert, nur angelegt oder
// geloescht.
migrate(
	(app) => {
		const collection = app.findCollectionByNameOrId('expenses');

		// Erst holen, pruefen, dann setzen: Migrationen laufen bei jedem
		// Bootstrap, und ein Wurf hier nimmt die ganze App mit runter.
		const amount = collection.fields.getByName('amount_cents');
		if (amount) amount.min = -1000000;

		collection.createRule = '@request.auth.id != "" && @request.body.amount_cents != 0';

		app.save(collection);
	},
	(app) => {
		const collection = app.findCollectionByNameOrId('expenses');

		const amount = collection.fields.getByName('amount_cents');
		if (amount) amount.min = 1;

		collection.createRule = '@request.auth.id != ""';

		// Bestandsdaten: PocketBase prueft beim Speichern den *ganzen* Record.
		// Eine Erstattung liesse sich nach dem Zurueckdrehen also nicht mehr
		// anfassen -- und in der Auswertung zaehlte sie weiter mit. Weg damit.
		app.db().newQuery('DELETE FROM expenses WHERE amount_cents < 1').execute();

		app.save(collection);
	}
);
