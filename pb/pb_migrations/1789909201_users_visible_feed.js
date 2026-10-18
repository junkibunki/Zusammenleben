/// <reference path="../pb_data/types.d.ts" />

// Name und Foto im Trainings-Feed (1789909200): die ViewRule von `users` laesst
// sonst nur Mitbewohner durch (1789304400), und bei Leuten aus anderen
// Haushalten stuende "Jemand" -- wie zuvor bei den Ideen-Autoren. Sichtbar
// werden nur, wer oeffentlich trainiert und einen Beitrag hat, und wer auf die
// Schulter geklopft hat. Die ListRule bleibt: der Feed holt Namen per `expand`,
// und das geht ueber die ViewRule.
//
// Eigene Migration statt Teil von 1789909200: die lief lokal schon, bevor die
// Luecke auffiel.
//
// `kudos.id`, nicht `kudos`: bei einer Mehrfach-Relation trifft
// `@collection.training_posts.kudos ?= id` still nie (nachgemessen, siehe
// docs/pitfalls/migrationen.md).

const FEED_USERS =
	'(@request.auth.id != "" && ((training_public = true && @collection.training_posts.user ?= id) || ' +
	'@collection.training_posts.kudos.id ?= id))';
const SUFFIX = ` || ${FEED_USERS}`;

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		if (!users.viewRule || users.viewRule.indexOf(FEED_USERS) !== -1) return;
		users.viewRule = `(${users.viewRule})${SUFFIX}`;
		app.save(users);
	},
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		const rule = users.viewRule || '';
		if (!rule.startsWith('(') || !rule.endsWith(`)${SUFFIX}`)) return;
		users.viewRule = rule.slice(1, -(SUFFIX.length + 1));
		app.save(users);
	}
);
