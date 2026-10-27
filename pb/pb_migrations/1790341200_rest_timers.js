/// <reference path="../pb_data/types.d.ts" />

// Satzpause: das Ende der laufenden Pause pro Person, damit der Server am Ende
// eine Push-Meldung schickt, wenn das Handy gesperrt ist (pb_hooks/
// training.pb.js, training-lib.js). Keine API-Rules: geschrieben und geloescht
// wird nur ueber die Routen /api/training/rest, und die Zeile verschwindet mit
// dem Versand. Eine Zeile pro Person -- eine neue Pause ersetzt die alte.

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');

		app.save(
			new Collection({
				type: 'base',
				name: 'rest_timers',
				listRule: null,
				viewRule: null,
				createRule: null,
				updateRule: null,
				deleteRule: null,
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
						cascadeDelete: true,
						maxSelect: 1
					},
					// Ende der Pause in Millisekunden seit 1970 (Date.now() des Clients).
					{ name: 'due', type: 'number', required: true, min: 0, onlyInt: true },
					{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
					{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
				],
				indexes: [
					'CREATE UNIQUE INDEX `idx_rest_timers_user` ON `rest_timers` (`user`)',
					'CREATE INDEX `idx_rest_timers_due` ON `rest_timers` (`due`)'
				]
			})
		);
	},
	(app) => {
		try {
			app.delete(app.findCollectionByNameOrId('rest_timers'));
		} catch {
			// Schon weg -- nichts zu tun.
		}
	}
);
