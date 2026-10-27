/// <reference path="../pb_data/types.d.ts" />

// Feed: Cardio im Beitrag des Tages (Strecken aus Migration 1790427600).
//
// * `training_posts.cardio` -- `[{ kind, distance, duration }]` je Strecke des
//                              Tages, in der Reihenfolge des Starts. Nur
//                              Kennzahlen, nie die Punkte: eine Route verraet,
//                              wo jemand wohnt. Gesetzt von rebuildPost()
//                              (pb_hooks/training-lib.js).

migrate(
	(app) => {
		const posts = app.findCollectionByNameOrId('training_posts');
		if (posts.fields.getByName('cardio')) return;
		posts.fields.add(
			new JSONField({ id: 'json_training_posts_cardio', name: 'cardio', required: false, maxSize: 4000 })
		);
		app.save(posts);
	},
	(app) => {
		const posts = app.findCollectionByNameOrId('training_posts');
		if (!posts.fields.getByName('cardio')) return;
		posts.fields.removeByName('cardio');
		app.save(posts);
	}
);
