/// <reference path="../pb_data/types.d.ts" />

// Das Feld `category` beantwortet jetzt "Wo einkaufen?" statt "Warengruppe".
// Der Feldname bleibt -- ein Rename waere ein Datenverlust ohne Gegenwert.
//
// Bestandsdaten muessen mit: PocketBase prueft bei jedem Save den ganzen
// Record, nicht nur die geschickten Felder. Ein Item mit dem alten Wert
// "Obst/Gemuese" liesse sich also nicht mehr abhaken.
const OLD = ['Obst/Gemüse', 'Kühlregal', 'Trocken', 'Getränke', 'Drogerie', 'Sonstiges'];
const NEW = ['Supermarkt', 'Drogerie', 'Baumarkt', 'IKEA'];

migrate(
	(app) => {
		const items = app.findCollectionByNameOrId('items');
		const field = items.fields.getByName('category');
		if (!field) return; // nie werfen: Migrationen laufen bei jedem Bootstrap
		field.values = NEW;
		app.save(items);

		// Alles ausser "Drogerie" (in beiden Listen enthalten) wird Supermarkt.
		app.db()
			.newQuery("UPDATE items SET category = 'Supermarkt' WHERE category != '' AND category != 'Drogerie'")
			.execute();
	},
	(app) => {
		const items = app.findCollectionByNameOrId('items');
		const field = items.fields.getByName('category');
		if (!field) return;
		field.values = OLD;
		app.save(items);

		// Die urspruengliche Warengruppe ist nicht rekonstruierbar.
		app.db()
			.newQuery("UPDATE items SET category = 'Sonstiges' WHERE category != '' AND category != 'Drogerie'")
			.execute();
	}
);
