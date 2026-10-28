/// <reference path="../pb_data/types.d.ts" />

// Trainings freigeben: andere sehen ein freigegebenes Training samt Uebungen
// und koennen es in den eigenen Plan kopieren (Route in
// pb_hooks/training-share.pb.js). Der Verlauf bleibt privat -- `training_logs`
// aendert sich nicht.
//
// * `training_workouts.shared` -- setzt nur der Besitzer (UpdateRule `OWN`).
// * List-/ViewRule von `training_workouts` und `training_exercises` oeffnen fuer
//   freigegebene Trainings, aber nur solange der Besitzer Training eingeschaltet
//   hat (`users.show_training`). Dieselbe Bedingung oeffnet `users` schon fuer
//   die Suche im Feed (1790254800) -- ohne sie bliebe `expand: 'user'` leer.

const OWN = 'user = @request.auth.id';
const SHARED_WORKOUT = '(@request.auth.id != "" && shared = true && user.show_training = true)';
const SHARED_EXERCISE =
	'(@request.auth.id != "" && workout.shared = true && workout.user.show_training = true)';

const RULES = {
	training_workouts: `${OWN} || ${SHARED_WORKOUT}`,
	training_exercises: `${OWN} || ${SHARED_EXERCISE}`
};

migrate(
	(app) => {
		const workouts = app.findCollectionByNameOrId('training_workouts');
		if (!workouts.fields.getByName('shared')) {
			workouts.fields.add(
				new BoolField({ id: 'bool_training_workouts_shared', name: 'shared', required: false })
			);
			app.save(workouts);
		}

		// Erst nach dem Feld: PocketBase prueft die Rule beim Speichern.
		for (const name of Object.keys(RULES)) {
			const collection = app.findCollectionByNameOrId(name);
			collection.listRule = RULES[name];
			collection.viewRule = RULES[name];
			app.save(collection);
		}
	},
	(app) => {
		for (const name of Object.keys(RULES)) {
			const collection = app.findCollectionByNameOrId(name);
			collection.listRule = OWN;
			collection.viewRule = OWN;
			app.save(collection);
		}
		const workouts = app.findCollectionByNameOrId('training_workouts');
		if (workouts.fields.getByName('shared')) {
			workouts.fields.removeByName('shared');
			app.save(workouts);
		}
	}
);
