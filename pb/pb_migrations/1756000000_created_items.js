/// <reference path="../pb_data/types.d.ts" />

// Collection "items" -- die eigentliche Einkaufsliste.
// API-Rules bewusst simpel: wer eingeloggt ist, darf alles.
migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		const rule = '@request.auth.id != ""';

		const collection = new Collection({
			type: 'base',
			name: 'items',
			listRule: rule,
			viewRule: rule,
			createRule: rule,
			updateRule: rule,
			deleteRule: rule,
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
				{ name: 'name', type: 'text', required: true, max: 200 },
				{ name: 'quantity', type: 'text', required: false, max: 100 },
				{
					name: 'category',
					type: 'select',
					required: false,
					maxSelect: 1,
					values: ['Obst/Gemüse', 'Kühlregal', 'Trocken', 'Getränke', 'Drogerie', 'Sonstiges']
				},
				// bool kennt keinen Default -- "nicht gesetzt" ist false, das reicht hier.
				{ name: 'done', type: 'bool', required: false },
				{ name: 'note', type: 'text', required: false, max: 500 },
				{
					name: 'added_by',
					type: 'relation',
					required: false,
					collectionId: users.id,
					cascadeDelete: false,
					maxSelect: 1
				},
				{
					name: 'done_by',
					type: 'relation',
					required: false,
					collectionId: users.id,
					cascadeDelete: false,
					maxSelect: 1
				},
				{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
				{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
			],
			indexes: ['CREATE INDEX `idx_items_done` ON `items` (`done`)']
		});

		app.save(collection);
	},
	(app) => {
		app.delete(app.findCollectionByNameOrId('items'));
	}
);
