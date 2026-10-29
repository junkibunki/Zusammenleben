/// <reference path="../pb_data/types.d.ts" />

// Die ViewRule von `users` war ueber 1789304400, 1789909201/02, 1790082000 und
// 1790254800 auf rund zwanzig `@collection`-Verweise gewachsen. PocketBase macht aus jedem
// einen JOIN, die Zeilen multiplizieren sich, und jedes `expand` auf einen
// Namen kostete in Produktion ~2 s -- die Einkaufsliste (added_by, done_by)
// also ~4 s statt 40 ms, und mit jedem Beitrag wurde es mehr
// (docs/pitfalls/migrationen.md).
//
// Jetzt darf jeder Angemeldete einen Account *per ID* abrufen: Name und Foto.
// Die ListRule bleibt unveraendert (Mitbewohner + wer Training eingeschaltet
// hat, 1790254800) -- auflisten laesst sich darueber hinaus niemand. Die IDs
// kennt man aus gemeinsamen Inhalten (Ideen, Likes, Feed, "Muessen wir mal
// machen"), und dort war der Name meist schon sichtbar.
// Die E-Mail schuetzt weiter `emailVisibility`.

const SIMPLE = '@request.auth.id != ""';

// Die alte Rule, so wie die Migrationen davor sie zusammengesetzt haben -- fuer
// das Zuruecknehmen.
const ACTIVE = (a) =>
	`(@collection.memberships:${a}.until ?= "" || @collection.memberships:${a}.until ?> @now)`;
const CO_MEMBER =
	'@collection.memberships:theirs.user ?= id && ' +
	'@collection.memberships:mine.user ?= @request.auth.id && ' +
	'@collection.memberships:mine.household ?= @collection.memberships:theirs.household && ' +
	ACTIVE('mine');
const BASE =
	`@request.auth.id != "" && (id = @request.auth.id || (${CO_MEMBER}) || ` +
	'@collection.ideas.author ?= id || @collection.ideas.resolved_by ?= id)';
const FEED_USERS =
	'(@request.auth.id != "" && ((training_public = true && @collection.training_posts.user ?= id) || ' +
	'@collection.training_posts.kudos.id ?= id))';
const TOGETHER_USERS =
	'(@request.auth.id != "" && (' +
	'(@collection.together:ta.author ?= id && @collection.together:ta.household ?= "") || ' +
	'(@collection.together:ti.interested.id ?= id && @collection.together:ti.household ?= "") || ' +
	'(@collection.together:td.done_by ?= id && @collection.together:td.household ?= "") || ' +
	'(@collection.together_comments:tc.author ?= id && @collection.together_comments:tc.entry.household ?= "")))';
const FOLLOW_USERS =
	'(@request.auth.id != "" && (show_training = true || ' +
	'(@collection.training_follows:f.follower ?= @request.auth.id && @collection.training_follows:f.followed ?= id)))';
const OLD = `(((${BASE}) || ${FEED_USERS}) || ${TOGETHER_USERS}) || ${FOLLOW_USERS}`;

// `viewRule` ist in der JS-VM ein Go-*string, kein JS-String: `===` gegen ein
// Literal ist dann still immer falsch. Deshalb erst `String(…)`.
const ruleOf = (collection) => String(collection.viewRule ?? '');

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		if (ruleOf(users) === SIMPLE) return;
		users.viewRule = SIMPLE;
		app.save(users);
	},
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		if (ruleOf(users) !== SIMPLE) return;
		users.viewRule = OLD;
		app.save(users);
	}
);
