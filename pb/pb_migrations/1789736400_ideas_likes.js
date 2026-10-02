/// <reference path="../pb_data/types.d.ts" />

// Ideen liken: `likes` haelt die Accounts, die eine Idee gut finden. Der Feed
// sortiert offene Ideen danach (frontend/src/lib/ideas.svelte.js).
//
// Eine Relation auf dem Record statt einer eigenen Collection: der Zaehler
// kommt mit dem Record, und der Client aendert ihn nur ueber die Modifier
// `likes+` / `likes-` -- die rechnet der Server auf den aktuellen Stand,
// gleichzeitige Likes zweier Leute ueberschreiben sich also nicht.
//
// Die UpdateRule (`@request.auth.id != ""`) bleibt; dass jeder nur sich selbst
// hinzufuegt oder entfernt und niemand die eigene Idee liked, prueft
// pb_hooks/ideas.pb.js.
//
// Keine Aenderung an der ViewRule von `users`: der Feed zeigt nur die Anzahl,
// nicht wer geliked hat.

migrate(
	(app) => {
		const ideas = app.findCollectionByNameOrId('ideas');
		if (ideas.fields.getByName('likes')) return;
		const users = app.findCollectionByNameOrId('users');
		ideas.fields.add(
			new RelationField({
				id: 'relation_ideas_likes',
				name: 'likes',
				required: false,
				collectionId: users.id,
				// Wer seinen Account loescht, faellt aus den Likes raus -- die Idee bleibt.
				cascadeDelete: false,
				maxSelect: 999
			})
		);
		app.save(ideas);
	},
	(app) => {
		const ideas = app.findCollectionByNameOrId('ideas');
		if (!ideas.fields.getByName('likes')) return;
		ideas.fields.removeByName('likes');
		app.save(ideas);
	}
);
