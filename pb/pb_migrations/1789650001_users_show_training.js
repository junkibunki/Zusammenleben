/// <reference path="../pb_data/types.d.ts" />

// Ob "Training" im Menue steht -- pro Person im Profil umschaltbar, Standard aus.
// Ein `bool` kennt kein `default`; "nicht gesetzt" ist `false`, das genuegt.
//
// Wer es ausschaltet, bekommt auch keine Trainingserinnerung mehr
// (pb_hooks/training-lib.js): eine Meldung, die auf eine versteckte Seite
// fuehrt, waere eher verwirrend.

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		if (users.fields.getByName('show_training')) return;
		users.fields.add(new BoolField({ id: 'bool_users_show_training', name: 'show_training' }));
		app.save(users);
	},
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		if (!users.fields.getByName('show_training')) return;
		users.fields.removeByName('show_training');
		app.save(users);
	}
);
