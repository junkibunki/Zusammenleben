/// <reference path="../pb_data/types.d.ts" />

// Cardio: aufgezeichnete Strecken (Laufen, Radfahren, Gehen).
//
// * `training_routes` -- eine Zeile pro Aufzeichnung. `points` ist die Strecke
//                        als JSON-Liste `[[lat, lng, s], …]`: Grad auf 5
//                        Nachkommastellen (~1 m), `s` = Sekunden seit `started`.
//                        `distance` (m) und `duration` (s) rechnet der Client
//                        beim Aufzeichnen mit; so muss die Liste kein JSON lesen.
//
// Privat wie der Rest des Trainings: jede Rule auf `user = @request.auth.id`.
// Aufgezeichnet wird nur bei eingeschaltetem Bildschirm -- im Web gibt es keinen
// Standort im Hintergrund (frontend/src/lib/cardio.svelte.js).

const KINDS = ['run', 'bike', 'walk'];

const OWN = 'user = @request.auth.id';
const CREATE_OWN = '@request.auth.id != "" && @request.body.user = @request.auth.id';
const KEEP_USER = '(@request.body.user:isset = false || @request.body.user = user)';

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');

		const routes = new Collection({
			type: 'base',
			name: 'training_routes',
			listRule: OWN,
			viewRule: OWN,
			createRule: CREATE_OWN,
			updateRule: `${OWN} && ${KEEP_USER}`,
			deleteRule: OWN,
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
				// Tag des Starts in der Zeit des Geraets, wie `training_sessions.date`.
				{
					name: 'date',
					type: 'text',
					required: true,
					max: 10,
					pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
				},
				{ name: 'kind', type: 'select', required: true, maxSelect: 1, values: KINDS },
				{ name: 'started', type: 'date', required: true },
				// Sekunden bzw. Meter.
				{ name: 'duration', type: 'number', required: false, onlyInt: true, min: 0, max: 86400 },
				{ name: 'distance', type: 'number', required: false, onlyInt: true, min: 0, max: 1000000 },
				// 24 h mit einem Punkt alle 3 s sind knapp 30000 Punkte, gut 700 KB.
				{ name: 'points', type: 'json', required: false, maxSize: 2000000 },
				{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
				{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
			],
			indexes: [
				'CREATE INDEX `idx_training_routes_user_started` ON `training_routes` (`user`, `started`)'
			]
		});
		app.save(routes);
	},
	(app) => {
		try {
			app.delete(app.findCollectionByNameOrId('training_routes'));
		} catch {
			// Schon weg -- nichts zu tun.
		}
	}
);
