/// <reference path="../pb_data/types.d.ts" />

// Feed: Volumen des Tages (Summe Gewicht x Wdh. der Arbeitssaetze, in kg, auf
// ganze kg gerundet) -- wie `volumeOf` im Frontend. Bei Koerpergewichtsuebungen
// zaehlt nur das Zusatzgewicht. Schreibt wie den Rest des Beitrags nur der
// Server (training-lib.js); die vorhandenen Beitraege rechnet diese Migration
// einmal aus den Saetzen nach.

migrate(
	(app) => {
		const posts = app.findCollectionByNameOrId('training_posts');
		if (posts.fields.getByName('volume')) return;
		posts.fields.add(new NumberField({ id: 'number_training_posts_volume', name: 'volume', onlyInt: true, min: 0 }));
		app.save(posts);

		// Unlesbares `sets` zaehlt als leer, statt die Migration (und damit den
		// Start) abzubrechen.
		app
			.db()
			.newQuery(
				`UPDATE training_posts SET volume = COALESCE((
					SELECT ROUND(SUM(
						COALESCE(CAST(json_extract(s.value, '$.weight') AS REAL), 0) *
						COALESCE(CAST(json_extract(s.value, '$.reps') AS REAL), 0)
					))
					FROM training_logs l,
						json_each(CASE WHEN json_valid(l.sets) THEN l.sets ELSE '[]' END) s
					WHERE l.user = training_posts.user
						AND l.date = training_posts.date
						AND COALESCE(json_extract(s.value, '$.warmup'), 0) = 0
				), 0)`
			)
			.execute();
	},
	(app) => {
		const posts = app.findCollectionByNameOrId('training_posts');
		if (!posts.fields.getByName('volume')) return;
		posts.fields.removeByName('volume');
		app.save(posts);
	}
);
