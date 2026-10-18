/// <reference path="../pb_data/types.d.ts" />

// Trainings-Feed: alle Nutzer der App (nicht nur der Haushalt) sehen, wer
// trainiert hat, und koennen auf die Schulter klopfen.
//
// * `users.training_public` -- eigene Trainings im Feed zeigen. Standard aus.
//   Aus heisst: keine neuen Beitraege, und die vorhandenen sind fuer andere
//   unsichtbar (List-/ViewRule).
// * `training_posts` -- ein Beitrag pro Person und Tag, nur Kennzahlen, keine
//   Gewichte: Trainingsname, Dauer, Zahl der Uebungen und Arbeitssaetze, Namen
//   der Uebungen mit neuem Bestwert. Den Beitrag schreibt ausschliesslich der
//   Server (pb_hooks/training.pb.js), sobald sich Eintraege oder Dauer des Tages
//   aendern -- die Trainingsdaten selbst bleiben privat.
// * `training_posts.kudos` -- wer auf die Schulter geklopft hat. Wie die Likes
//   der Ideen (1789736400) eine Relation, geaendert nur ueber `kudos+`/`kudos-`;
//   dass jeder nur sich selbst setzt und nicht beim eigenen Beitrag, prueft der
//   Hook.
//
// Name und Foto ueber den Haushalt hinaus: 1789909201.

const VISIBLE = '@request.auth.id != "" && (user = @request.auth.id || user.training_public = true)';

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		if (!users.fields.getByName('training_public')) {
			users.fields.add(new BoolField({ id: 'bool_users_training_public', name: 'training_public' }));
			app.save(users);
		}

		const posts = new Collection({
			type: 'base',
			name: 'training_posts',
			listRule: VISIBLE,
			viewRule: VISIBLE,
			// Anlegen und Loeschen nur der Server.
			createRule: null,
			// Nur `kudos` -- der Rest wird im Hook abgewiesen.
			updateRule: `${VISIBLE} && user != @request.auth.id`,
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
				{
					name: 'date',
					type: 'text',
					required: true,
					max: 10,
					pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
				},
				// Name(n) der Trainings des Tages, z.B. "Push" oder "Push + Beine".
				{ name: 'workout', type: 'text', required: false, max: 200 },
				// Sekunden.
				{ name: 'duration', type: 'number', required: false, onlyInt: true, min: 0, max: 86400 },
				{ name: 'exercises', type: 'number', required: false, onlyInt: true, min: 0 },
				{ name: 'sets', type: 'number', required: false, onlyInt: true, min: 0 },
				// Namen der Uebungen mit neuem Bestwert (ohne Gewicht).
				{ name: 'records', type: 'json', required: false, maxSize: 4000 },
				{
					name: 'kudos',
					type: 'relation',
					required: false,
					collectionId: users.id,
					// Wer seinen Account loescht, faellt raus -- der Beitrag bleibt.
					cascadeDelete: false,
					maxSelect: 999
				},
				{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
				{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
			],
			indexes: [
				'CREATE UNIQUE INDEX `idx_training_posts_day` ON `training_posts` (`user`, `date`)',
				'CREATE INDEX `idx_training_posts_date` ON `training_posts` (`date`)'
			]
		});
		app.save(posts);
	},
	(app) => {
		try {
			app.delete(app.findCollectionByNameOrId('training_posts'));
		} catch {
			// Schon weg -- nichts zu tun.
		}
		const users = app.findCollectionByNameOrId('users');
		if (users.fields.getByName('training_public')) {
			users.fields.removeByName('training_public');
			app.save(users);
		}
	}
);
