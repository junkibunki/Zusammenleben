/// <reference path="../pb_data/types.d.ts" />

// Freigegebenes Training in den eigenen Plan kopieren (Migration 1790686800).
//
// Eine Route statt Creates aus dem Client: Training und Uebungen entstehen in
// *einer* Transaktion -- bricht eine Uebung ab, bleibt kein halbes Training
// stehen. Ob man das Training sehen darf, entscheidet dieselbe ViewRule wie
// beim Lesen (canAccessRecord), nicht eine zweite Kopie der Bedingung hier.
//
// Kopiert werden nur Name und Ziele der Uebungen, kein Verlauf. Gibt es den
// Namen schon (der Unique-Index ignoriert Gross-/Kleinschreibung), bekommt die
// Kopie eine Nummer: "Push 2", "Push 3", …
routerAdd(
	'POST',
	'/api/training/workouts/{id}/copy',
	(e) => {
		const NAME_MAX = 40;
		const FIELDS = ['name', 'sets', 'reps', 'kind', 'reps_max', 'rest', 'increment', 'sort'];
		const me = e.auth.id;
		const gone = 'Dieses Training ist nicht mehr freigegeben.';

		let source = null;
		try {
			source = e.app.findRecordById('training_workouts', e.request.pathValue('id'));
		} catch (err) {
			// Kein Treffer wirft -- siehe wishes.pb.js.
		}
		if (!source || !e.app.canAccessRecord(source, e.requestInfo(), source.collection().viewRule)) {
			throw new NotFoundError(gone);
		}

		let result = null;
		e.app.runInTransaction((txApp) => {
			const taken = {};
			let sort = 0;
			for (const w of txApp.findRecordsByFilter('training_workouts', 'user = {:u}', '', 0, 0, { u: me })) {
				taken[w.getString('name').toLowerCase()] = true;
				sort = Math.max(sort, w.getInt('sort') + 1);
			}
			const base = source.getString('name').trim();
			let name = base;
			for (let n = 2; taken[name.toLowerCase()]; n++) {
				const suffix = ` ${n}`;
				name = base.slice(0, NAME_MAX - suffix.length).trim() + suffix;
			}

			const workout = new Record(source.collection());
			workout.set('user', me);
			workout.set('name', name);
			workout.set('sort', sort);
			txApp.save(workout);

			const exercises = [];
			const list = txApp.findRecordsByFilter('training_exercises', 'workout = {:w}', 'sort,created', 0, 0, {
				w: source.id
			});
			for (const src of list) {
				const ex = new Record(src.collection());
				ex.set('user', me);
				ex.set('workout', workout.id);
				for (const key of FIELDS) ex.set(key, src.get(key));
				txApp.save(ex);
				exercises.push(ex);
			}
			result = { workout, exercises };
		});

		return e.json(200, result);
	},
	$apis.requireAuth('users')
);
