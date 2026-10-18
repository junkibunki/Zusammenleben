/// <reference path="../pb_data/types.d.ts" />

// Reparatur fuer 1789909201: dessen erste Fassung schrieb
// `@collection.training_posts.kudos ?= id`, und das trifft bei einer
// Mehrfach-Relation nie (docs/pitfalls/migrationen.md). Lokal lief diese
// Fassung schon. Hier wird der Feed-Teil der ViewRule abgeschnitten und in der
// richtigen Form neu angehaengt -- dieselbe Form, die die korrigierte 1789909201
// schreibt. Steht er schon richtig da, tut die Migration nichts.

const FEED_USERS =
	'(@request.auth.id != "" && ((training_public = true && @collection.training_posts.user ?= id) || ' +
	'@collection.training_posts.kudos.id ?= id))';
const SUFFIX = ` || ${FEED_USERS}`;
const CUT = ' || (@request.auth.id != "" && (';

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		const rule = users.viewRule || '';
		if (rule.indexOf('training_posts') === -1 || rule.endsWith(`)${SUFFIX}`)) return;

		// Ab dem ersten angehaengten Teil, der `training_posts` nennt, abschneiden.
		let at = rule.indexOf(CUT);
		while (at !== -1 && rule.indexOf('training_posts', at) === -1) at = rule.indexOf(CUT, at + 1);
		if (at === -1) return;
		const base = rule.slice(0, at);
		users.viewRule = `(${base})${SUFFIX}`;
		app.save(users);
	},
	() => {
		// Nichts zurueckzunehmen: die kaputte Fassung will niemand wiederhaben.
	}
);
