/// <reference path="../pb_data/types.d.ts" />

// `note` war als einzeilige Randbemerkung gedacht (max. 500). Seit es eine
// Detailseite mit Textfeld gibt, ist es die eigentliche Beschreibung des
// Eintrags -- 500 Zeichen sind dafuer knapp.
const LONG = 2000;
const SHORT = 500;

function setMax(app, max) {
	const items = app.findCollectionByNameOrId('items');
	const field = items.fields.getByName('note');
	if (!field) return; // nie werfen: Migrationen laufen bei jedem Bootstrap
	field.max = max;
	app.save(items);
}

migrate(
	(app) => {
		setMax(app, LONG);
	},
	(app) => {
		// Zurueck auf 500 wuerde laengere Bestandstexte unspeicherbar machen --
		// PocketBase prueft beim Save den ganzen Record, nicht nur die
		// geschickten Felder. Deshalb vorher kappen.
		app.db()
			.newQuery(`UPDATE items SET note = substr(note, 1, ${SHORT}) WHERE length(note) > ${SHORT}`)
			.execute();
		setMax(app, SHORT);
	}
);
