/// <reference path="../pb_data/types.d.ts" />

// Keine Selbstregistrierung: Accounts werden im Admin-UI angelegt.
migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		users.createRule = null;
		app.save(users);
	},
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		users.createRule = '';
		app.save(users);
	}
);
