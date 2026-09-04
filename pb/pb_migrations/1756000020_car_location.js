/// <reference path="../pb_data/types.d.ts" />

// Wo steht Gundula? Genau ein Standort, also genau ein Record: die Migration
// legt ihn selbst an, und `createRule`/`deleteRule` bleiben `null` (= nur
// Superuser). Damit kann niemand einen zweiten Pin erzeugen oder den einen
// wegloeschen -- die Seite muss nie entscheiden, welcher von mehreren gilt.
//
// "Noch nie geparkt" ist `parked_at == ""`. An `lat`/`lng` laesst sich das
// nicht erkennen: ein number-Feld ist ohne Wert 0, und 0/0 waere ein
// gueltiger Punkt im Golf von Guinea.
migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		const loggedIn = '@request.auth.id != ""';

		app.save(
			new Collection({
				type: 'base',
				name: 'car_location',
				listRule: loggedIn,
				viewRule: loggedIn,
				createRule: null,
				updateRule: loggedIn,
				deleteRule: null,
				fields: [
					{
						name: 'id',
						type: 'text',
						system: true,
						primaryKey: true,
						required: true,
						min: 1,
						max: 15,
						pattern: '^[a-z0-9]+$'
					},
					// Grenzen als Feldvalidierung: ein Tippfehler im Client kommt
					// nicht in die DB, und PocketBase antwortet mit einem Feldfehler.
					{ name: 'lat', type: 'number', required: false, min: -90, max: 90 },
					{ name: 'lng', type: 'number', required: false, min: -180, max: 180 },
					{
						name: 'parked_by',
						type: 'relation',
						required: false,
						collectionId: users.id,
						// Wer geparkt hat, kann seinen Account loeschen -- der Standort
						// bleibt trotzdem gueltig.
						cascadeDelete: false,
						maxSelect: 1
					},
					{ name: 'parked_at', type: 'date', required: false },
					{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
					{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
				]
			})
		);

		// Der eine Record. Feste ID, damit der Client sie kennen darf.
		const collection = app.findCollectionByNameOrId('car_location');
		const record = new Record(collection);
		record.set('id', 'gundula');
		app.save(record);
	},
	(app) => {
		app.delete(app.findCollectionByNameOrId('car_location'));
	}
);
