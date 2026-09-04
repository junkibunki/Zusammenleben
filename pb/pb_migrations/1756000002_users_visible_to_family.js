/// <reference path="../pb_data/types.d.ts" />

// Eingeloggte duerfen die Stammdaten der anderen Nutzer *sehen*.
// Ohne das liefert `expand=added_by,done_by` leere Objekte -- PocketBase prueft
// beim Expand die ViewRule der Zielcollection, und die laesst per Default nur den
// eigenen Datensatz durch. Bewusst nur ViewRule: die ListRule bleibt hier eng, damit
// `users` nicht komplett auflistbar und per Filter durchsuchbar wird.
// (Fuer die Seite "Bewohner" oeffnet `1756000004` sie dann doch -- die Begruendung
// steht dort.)
migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		users.viewRule = '@request.auth.id != ""';
		app.save(users);
	},
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		users.viewRule = 'id = @request.auth.id';
		app.save(users);
	}
);
