/// <reference path="../pb_data/types.d.ts" />

// Schnellleiste unten: bis zu drei Seiten, pro Person im Profil gewaehlt.
// Gespeichert als JSON-Liste der Pfade (`["/", "/ausgaben"]`), damit die
// Auswahl auf jedem Geraet gleich ist. `null` heisst "nie eingestellt" -- dann
// zeigt das Frontend eine Vorgabe; `[]` heisst "bewusst leer", keine Leiste.
// Laenge und erlaubte Pfade prueft das Frontend beim Lesen: wer sich hier
// Unsinn hineinschreibt, trifft damit nur seine eigene Leiste.

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		if (users.fields.getByName('quick_nav')) return;
		users.fields.add(new JSONField({ id: 'json_users_quick_nav', name: 'quick_nav', maxSize: 2000 }));
		app.save(users);
	},
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		if (!users.fields.getByName('quick_nav')) return;
		users.fields.removeByName('quick_nav');
		app.save(users);
	}
);
