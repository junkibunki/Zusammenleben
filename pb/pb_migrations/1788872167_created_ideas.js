/// <reference path="../pb_data/types.d.ts" />

// Collection "ideas" -- Erweiterungsvorschlaege fuer die App ("Neue Ideen fuer
// den gruenen Freund"). API-Rules wie bei `items`: wer eingeloggt ist, darf
// lesen, schreiben und abhaken.
//
// Der Zustand steckt in *einem* Feld: `status` leer = offen, sonst "umgesetzt"
// oder "abgelehnt". Ein zusaetzliches bool koennte davon abweichen; so kann es
// das nicht.
//
// `deleteRule: null` (= nur Superuser): abhaken ist die vorgesehene Art, eine
// Idee zu schliessen. Ein Fehlgriff soll den Vorschlag eines anderen nicht
// spurlos aus dem Feed nehmen.
migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		const loggedIn = '@request.auth.id != ""';

		const collection = new Collection({
			type: 'base',
			name: 'ideas',
			listRule: loggedIn,
			viewRule: loggedIn,
			createRule: loggedIn,
			updateRule: loggedIn,
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
				{ name: 'text', type: 'text', required: true, max: 2000 },
				{
					name: 'author',
					type: 'relation',
					required: false,
					collectionId: users.id,
					// Wer die Idee hatte, kann seinen Account loeschen -- die Idee bleibt.
					cascadeDelete: false,
					maxSelect: 1
				},
				{
					name: 'status',
					type: 'select',
					required: false,
					maxSelect: 1,
					values: ['umgesetzt', 'abgelehnt']
				},
				{
					name: 'resolved_by',
					type: 'relation',
					required: false,
					collectionId: users.id,
					cascadeDelete: false,
					maxSelect: 1
				},
				{ name: 'resolved_at', type: 'date', required: false },
				{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
				{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
			],
			// Der Feed sortiert nach `created` absteigend.
			indexes: ['CREATE INDEX `idx_ideas_created` ON `ideas` (`created`)']
		});

		app.save(collection);
	},
	(app) => {
		app.delete(app.findCollectionByNameOrId('ideas'));
	}
);
