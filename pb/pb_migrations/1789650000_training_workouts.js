/// <reference path="../pb_data/types.d.ts" />

// Mehrere Trainings pro Person (z.B. "Push", "Pull", "Beine"), jedes mit
// eigenen Uebungen. Bisher hingen die Uebungen direkt an der Person
// (1789563600); jetzt haengen sie an einem Training.
//
// * `training_workouts` -- die Trainings einer Person mit Namen und Reihenfolge.
// * `training_exercises.workout` -- Pflicht-Relation darauf. Wird ein Training
//   geloescht, gehen seine Uebungen und deren Verlauf mit (cascadeDelete).
//
// Bestand: wer schon Uebungen hat, bekommt ein Training "Training", in dem
// sie alle landen.

const NAME_MAX = 40;
const DEFAULT_NAME = 'Training';

const OWN = 'user = @request.auth.id';
const CREATE_OWN = '@request.auth.id != "" && @request.body.user = @request.auth.id';
const KEEP_USER = '(@request.body.user:isset = false || @request.body.user = user)';

// Eine Uebung darf nur in einem eigenen Training stehen. Eigener Alias `wk`,
// damit ID und Besitzer dieselbe Zeile treffen.
const OWN_WORKOUT =
	'@collection.training_workouts:wk.id ?= @request.body.workout && ' +
	'@collection.training_workouts:wk.user ?= @request.auth.id';
const KEEP_WORKOUT = '(@request.body.workout:isset = false || @request.body.workout = workout)';

const idField = {
	name: 'id',
	type: 'text',
	system: true,
	primaryKey: true,
	required: true,
	min: 15,
	max: 15,
	pattern: '^[a-z0-9]+$',
	autogeneratePattern: '[a-z0-9]{15}'
};

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');

		const workouts = new Collection({
			type: 'base',
			name: 'training_workouts',
			listRule: OWN,
			viewRule: OWN,
			createRule: CREATE_OWN,
			updateRule: `${OWN} && ${KEEP_USER}`,
			deleteRule: OWN,
			fields: [
				idField,
				{
					name: 'user',
					type: 'relation',
					required: true,
					collectionId: users.id,
					cascadeDelete: true,
					maxSelect: 1
				},
				// `pattern`: `required` allein liesse einen Namen aus Leerzeichen durch.
				{ name: 'name', type: 'text', required: true, max: NAME_MAX, pattern: '\\S' },
				// Reihenfolge; bei Gleichstand entscheidet `created`.
				{ name: 'sort', type: 'number', onlyInt: true },
				{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
				{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
			],
			indexes: [
				// "Push" und "push" waeren zwei Trainings, die niemand auseinanderhaelt.
				'CREATE UNIQUE INDEX `idx_training_workouts_name` ON `training_workouts` (`user`, `name` COLLATE NOCASE)'
			]
		});
		app.save(workouts);

		// Erst ohne `required` anlegen, Bestand umhaengen, dann Pflicht machen.
		let exercises = app.findCollectionByNameOrId('training_exercises');
		if (!exercises.fields.getByName('workout')) {
			exercises.fields.add(
				new RelationField({
					id: 'relation_training_exercises_workout',
					name: 'workout',
					required: false,
					collectionId: workouts.id,
					cascadeDelete: true,
					maxSelect: 1
				})
			);
			app.save(exercises);
			exercises = app.findCollectionByNameOrId('training_exercises');
		}

		const byUser = {};
		for (const ex of app.findRecordsByFilter('training_exercises', 'workout = ""', '', 0, 0)) {
			const uid = ex.getString('user');
			if (!byUser[uid]) {
				const w = new Record(workouts);
				w.set('user', uid);
				w.set('name', DEFAULT_NAME);
				w.set('sort', 0);
				app.save(w);
				byUser[uid] = w.id;
			}
			ex.set('workout', byUser[uid]);
			app.save(ex);
		}

		exercises.fields.getByName('workout').required = true;
		exercises.createRule = `${CREATE_OWN} && ${OWN_WORKOUT}`;
		exercises.updateRule = `${OWN} && ${KEEP_USER} && ${KEEP_WORKOUT}`;
		app.save(exercises);
	},
	(app) => {
		const exercises = app.findCollectionByNameOrId('training_exercises');
		exercises.createRule = CREATE_OWN;
		exercises.updateRule = `${OWN} && ${KEEP_USER}`;
		exercises.fields.removeByName('workout');
		app.save(exercises);

		try {
			app.delete(app.findCollectionByNameOrId('training_workouts'));
		} catch {
			// Schon weg -- nichts zu tun.
		}
	}
);
