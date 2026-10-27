/// <reference path="../pb_data/types.d.ts" />

// Feed: das ganze Training im Beitrag, fuer die Detailseite (Antippen im Feed).
//
// * `training_posts.details` -- `[{ name, kind, sets: [{ weight, reps, seconds,
//                               warmup }] }]` je Uebung mit Arbeitssatz, in der
//                               Reihenfolge der Trainings und des Plans. Notizen
//                               bleiben draussen. Gesetzt von rebuildPost()
//                               (pb_hooks/training-lib.js); die vorhandenen
//                               Beitraege rechnet diese Migration einmal nach.
//
// Bisher stand im Beitrag bewusst kein einzelnes Gewicht (1789909200). Wer den
// Feed einschaltet, zeigt sein Training jetzt komplett -- der Text dazu steht
// im Profil.

/** Wie postDetail() in pb_hooks/training-lib.js. */
function postDetail(exercise, list) {
	const or = (v) => (typeof v === 'number' ? v : null);
	const sets = [];
	for (let i = 0; i < list.length; i++) {
		const s = list[i];
		if (!s) continue;
		sets.push({ weight: or(s.weight), reps: or(s.reps), seconds: or(s.seconds), warmup: s.warmup === true });
	}
	return { name: exercise.getString('name'), kind: exercise.getString('kind') || 'weight', sets };
}

function parseSets(log) {
	try {
		const sets = JSON.parse(log.getString('sets') || '[]');
		return Array.isArray(sets) ? sets : [];
	} catch {
		return [];
	}
}

migrate(
	(app) => {
		const posts = app.findCollectionByNameOrId('training_posts');
		if (posts.fields.getByName('details')) return;
		posts.fields.add(
			new JSONField({ id: 'json_training_posts_details', name: 'details', required: false, maxSize: 500000 })
		);
		app.save(posts);

		// Ein kaputter Beitrag darf den Start nicht abbrechen -- er bleibt dann
		// ohne Einzelheiten, bis sich an seinem Tag etwas aendert.
		for (const post of app.findAllRecords('training_posts')) {
			try {
				const params = { uid: post.getString('user'), d: post.getString('date') };
				const logs = app.findRecordsByFilter('training_logs', 'user = {:uid} && date = {:d}', '', 200, 0, params);
				const counts = {};
				const details = [];
				for (const log of logs) {
					const list = parseSets(log);
					if (!list.some((s) => s && !s.warmup)) continue;
					let exercise;
					try {
						exercise = app.findRecordById('training_exercises', log.getString('exercise'));
					} catch {
						continue;
					}
					const w = exercise.getString('workout');
					counts[w] = (counts[w] || 0) + 1;
					details.push({
						workout: w,
						sort: exercise.getInt('sort'),
						created: exercise.getString('created'),
						entry: postDetail(exercise, list)
					});
				}
				const order = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
				details.sort(
					(a, b) =>
						order.indexOf(a.workout) - order.indexOf(b.workout) ||
						a.sort - b.sort ||
						a.created.localeCompare(b.created)
				);
				post.set('details', details.map((d) => d.entry));
				app.saveNoValidate(post);
			} catch (err) {
				app.logger().warn('Beitrag ohne Einzelheiten', 'post', post.id, 'fehler', String(err));
			}
		}
	},
	(app) => {
		const posts = app.findCollectionByNameOrId('training_posts');
		if (!posts.fields.getByName('details')) return;
		posts.fields.removeByName('details');
		app.save(posts);
	}
);
