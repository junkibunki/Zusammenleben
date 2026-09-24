/// <reference path="../pb_data/types.d.ts" />

// `car_name`: wie der Haushalt sein Auto nennt. Bisher hiess es fuer alle
// "Gundula" -- das bleibt der Wert der Bestandshaushalte. Gepflegt vom
// Superuser im Admin-UI wie der Rest von `households`.
//
// Pflichtfeld statt eines Fallbacks im Client: die Seite spricht das Auto mit
// Namen an ("Wo ist …", "… hier parken"), ein generisches "Auto" liest sich
// dort holprig. Der Admin muss den Namen also beim Anlegen mitgeben.
const CAR_NAME_MAX = 40;

migrate(
	(app) => {
		const households = app.findCollectionByNameOrId('households');
		// `add` ersetzt ein gleichnamiges Feld, statt es zu doppeln.
		// `pattern`: `required` allein liesse einen Namen aus lauter Leerzeichen durch.
		households.fields.add(
			new TextField({ name: 'car_name', required: true, max: CAR_NAME_MAX, pattern: '\\S' })
		);
		app.save(households);

		// Bestand: PocketBase prueft beim Speichern den ganzen Record -- ohne Wert
		// liesse sich ein alter Haushalt im Admin-UI nicht mehr umbenennen.
		app.db()
			.newQuery("UPDATE households SET car_name = 'Gundula' WHERE car_name = '' OR car_name IS NULL")
			.execute();
	},
	(app) => {
		const households = app.findCollectionByNameOrId('households');
		households.fields.removeByName('car_name');
		app.save(households);
	}
);
