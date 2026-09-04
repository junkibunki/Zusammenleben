/// <reference path="../pb_data/types.d.ts" />

// Web Push: ein Abo pro Geraet und Person, dazu ein Platz fuer die
// VAPID-Schluessel des Servers.
//
// `push_config` haelt genau einen Record ("vapid"), den pb_hooks/push.pb.js
// beim ersten Start selbst anlegt. Bewusst ohne jede API-Rule: die Schluessel
// gehen nur den Server an, der oeffentliche Teil kommt ueber /api/push/key
// heraus. PocketBase-Rules `null` = nur Superuser.
//
// Die Kontaktadresse fuer den Push-Dienst steht hier absichtlich *nicht*: sie
// wird bei jedem Versand aus den PocketBase-Einstellungen bestimmt, sonst
// friert der Wert von dem Rechner ein, auf dem die Schluessel entstanden sind.
migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		const own = 'user = @request.auth.id';

		app.save(
			new Collection({
				type: 'base',
				name: 'push_config',
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
					{ name: 'public_key', type: 'text', required: true, max: 200 },
					{ name: 'private_key', type: 'text', required: true, max: 200 },
					{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
					{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
				]
			})
		);

		app.save(
			new Collection({
				type: 'base',
				name: 'push_subscriptions',
				// Jeder verwaltet nur die eigenen Abos. Auch beim Anlegen wird die
				// Regel gegen den neuen Record geprueft, `user` kann also nicht auf
				// jemand anderen zeigen.
				listRule: own,
				viewRule: own,
				createRule: `@request.auth.id != "" && ${own}`,
				updateRule: own,
				deleteRule: own,
				fields: [
					{
						name: 'id',
						type: 'text',
						system: true,
						primaryKey: true,
						required: true,
						min: 15,
						max: 15,
						pattern: '^[a-z0-9]+$',
						autogeneratePattern: '[a-z0-9]{15}'
					},
					{
						name: 'user',
						type: 'relation',
						required: true,
						collectionId: users.id,
						// Ohne Account kein Abo -- sonst pusht der Server ins Leere.
						cascadeDelete: true,
						maxSelect: 1
					},
					// Die Endpoint-URLs von FCM/Mozilla/Apple sind lang. `pattern`
					// begrenzt sie auf https: -- der Server postet woertlich dorthin,
					// ohne das koennte ein anderer Nutzer ihn zu einem Request auf
					// eine beliebige (auch interne) Adresse bewegen.
					{ name: 'endpoint', type: 'text', required: true, max: 1000, pattern: '^https://' },
					{ name: 'p256dh', type: 'text', required: true, max: 200 },
					{ name: 'auth', type: 'text', required: true, max: 100 },
					// Nur zur Anzeige ("Chrome auf Android"), nie zum Filtern.
					{ name: 'device', type: 'text', required: false, max: 200 },
					{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
					{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
				],
				// Ein Endpoint gehoert genau einem Geraet: erneutes Abonnieren
				// derselben Installation darf keinen zweiten Record anlegen.
				indexes: [
					'CREATE UNIQUE INDEX `idx_push_subscriptions_endpoint` ON `push_subscriptions` (`endpoint`)',
					'CREATE INDEX `idx_push_subscriptions_user` ON `push_subscriptions` (`user`)'
				]
			})
		);
	},
	(app) => {
		app.delete(app.findCollectionByNameOrId('push_subscriptions'));
		app.delete(app.findCollectionByNameOrId('push_config'));
	}
);
