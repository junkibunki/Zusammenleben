/// <reference path="../pb_data/types.d.ts" />

// Profilfoto: eine Thumb-Groesse fuer das vorhandene `avatar`-Feld registrieren.
// PocketBase liefert `?thumb=WxH` nur fuer Groessen aus dieser Liste aus und
// faellt sonst still auf das Original zurueck -- also ein Handyfoto in voller
// Groesse fuer ein 32px-Bildchen in der Navigation.
migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		const avatar = users.fields.getByName('avatar');
		if (!avatar) return; // ohne Feld nichts zu tun -- ein Wurf hier blockiert den Start
		avatar.thumbs = ['200x200'];
		app.save(users);
	},
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		const avatar = users.fields.getByName('avatar');
		if (!avatar) return;
		avatar.thumbs = [];
		app.save(users);
	}
);
