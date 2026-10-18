/// <reference path="../pb_data/types.d.ts" />

// "Muessen wir mal machen": Cafes, Ausfluege, Filme, Rezepte -- Dinge, die man
// zusammen unternehmen will. App-weit wie der Ideen-Feed, aber jeder Eintrag
// kann auf einen Haushalt beschraenkt werden.
//
// * `together.household` leer = fuer alle Nutzer der App sichtbar, sonst nur
//   fuer laufende Mitglieder dieses Haushalts (docs/pitfalls/mandanten.md).
// * `interested` -- wer "dabei" ist. Wie die Likes der Ideen (1789736400) nur
//   ueber `interested+`/`interested-` geaendert; dass jeder nur sich selbst
//   setzt, prueft pb_hooks/together.pb.js.
// * `planned_at` -- Termin als lokale Zeit "YYYY-MM-DD" oder
//   "YYYY-MM-DDTHH:MM", bewusst Text statt `date`: alle Nutzer leben in einer
//   Zeitzone, und so kann der Push-Text den Termin ohne Zeitzonen-Rechnung in
//   der JS-VM nennen. Als String sortiert er richtig.
// * Titel, Art, Notiz, Link und Sichtbarkeit aendert nur der Autor; Termin
//   und "gemacht" auch, wer dabei ist. Das kann die UpdateRule nicht
//   ausdruecken (kein Vergleich mit dem alten Wert) -- der Hook prueft es.
// * `together_comments` -- Kommentare, sichtbar fuer genau die, die den
//   Eintrag sehen. Nicht bearbeitbar, loeschen nur der Autor. Ein geloeschter
//   Eintrag nimmt seine Kommentare mit.

// Dieselben Bausteine wie in 1789304400, mit waehlbarem Alias: die Pruefung
// des neuen Haushalts im Update braucht einen eigenen (`target`), sonst
// muesste dieselbe Mitgliedschaft auf den alten *und* den neuen passen.
const ACTIVE = (a) =>
	`(@collection.memberships:${a}.until ?= "" || @collection.memberships:${a}.until ?> @now)`;

const memberOf = (a, field) =>
	`@collection.memberships:${a}.user ?= @request.auth.id && ` +
	`@collection.memberships:${a}.household ?= ${field} && ` +
	ACTIVE(a);

const AUTH = '@request.auth.id != ""';
const SEES = `(household = "" || (${memberOf('mine', 'household')}))`;
const SEES_ENTRY = `(entry.household = "" || (${memberOf('mine', 'entry.household')}))`;

// Name und Foto in Eintraegen *fuer alle*: die ViewRule von `users` laesst sonst
// nur Mitbewohner durch, und bei Leuten aus anderen Haushalten stuende
// "Jemand". Bei Haushalts-Eintraegen sind ohnehin alle Mitbewohner.
// `interested.id`, nicht `interested`: Mehrfach-Relation
// (docs/pitfalls/migrationen.md).
const TOGETHER_USERS =
	'(@request.auth.id != "" && (' +
	'(@collection.together:ta.author ?= id && @collection.together:ta.household ?= "") || ' +
	'(@collection.together:ti.interested.id ?= id && @collection.together:ti.household ?= "") || ' +
	'(@collection.together:td.done_by ?= id && @collection.together:td.household ?= "") || ' +
	'(@collection.together_comments:tc.author ?= id && @collection.together_comments:tc.entry.household ?= "")))';
const SUFFIX = ` || ${TOGETHER_USERS}`;

// Muss mit KINDS in frontend/src/lib/together.svelte.js uebereinstimmen.
const KINDS = ['essen', 'ausflug', 'film', 'rezept', 'event', 'sonstiges'];

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
		const households = app.findCollectionByNameOrId('households');

		const together = new Collection({
			type: 'base',
			name: 'together',
			listRule: `${AUTH} && ${SEES}`,
			viewRule: `${AUTH} && ${SEES}`,
			// `author` kommt aus dem Request: die Rule liest es, ein Hook kaeme zu
			// spaet (docs/pitfalls/pocketbase-hooks.md).
			createRule: `${AUTH} && author = @request.auth.id && ${SEES}`,
			updateRule:
				`${AUTH} && ${SEES} && (@request.body.household:isset = false || ` +
				`@request.body.household = "" || (${memberOf('target', '@request.body.household')}))`,
			deleteRule: `${AUTH} && author = @request.auth.id`,
			fields: [
				idField,
				{ name: 'title', type: 'text', required: true, max: 200 },
				{ name: 'kind', type: 'select', required: true, maxSelect: 1, values: KINDS },
				{ name: 'note', type: 'text', required: false, max: 2000 },
				{ name: 'link', type: 'url', required: false },
				{
					name: 'author',
					type: 'relation',
					required: false,
					collectionId: users.id,
					// Wer seinen Account loescht, faellt raus -- der Eintrag bleibt.
					cascadeDelete: false,
					maxSelect: 1
				},
				{
					name: 'household',
					type: 'relation',
					required: false,
					collectionId: households.id,
					cascadeDelete: true,
					maxSelect: 1
				},
				{
					name: 'interested',
					type: 'relation',
					required: false,
					collectionId: users.id,
					cascadeDelete: false,
					maxSelect: 999
				},
				{
					name: 'planned_at',
					type: 'text',
					required: false,
					max: 16,
					pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2})?$'
				},
				{ name: 'done_at', type: 'date', required: false },
				{
					name: 'done_by',
					type: 'relation',
					required: false,
					collectionId: users.id,
					cascadeDelete: false,
					maxSelect: 1
				},
				{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
				{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
			],
			indexes: ['CREATE INDEX `idx_together_household` ON `together` (`household`)']
		});
		app.save(together);

		const comments = new Collection({
			type: 'base',
			name: 'together_comments',
			listRule: `${AUTH} && ${SEES_ENTRY}`,
			viewRule: `${AUTH} && ${SEES_ENTRY}`,
			createRule: `${AUTH} && author = @request.auth.id && ${SEES_ENTRY}`,
			updateRule: null,
			deleteRule: `${AUTH} && author = @request.auth.id`,
			fields: [
				idField,
				{
					name: 'entry',
					type: 'relation',
					required: true,
					collectionId: together.id,
					cascadeDelete: true,
					maxSelect: 1
				},
				{
					name: 'author',
					type: 'relation',
					required: false,
					collectionId: users.id,
					cascadeDelete: false,
					maxSelect: 1
				},
				{ name: 'text', type: 'text', required: true, max: 1000 },
				{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false }
			],
			indexes: ['CREATE INDEX `idx_together_comments_entry` ON `together_comments` (`entry`)']
		});
		app.save(comments);

		if (users.viewRule && users.viewRule.indexOf(TOGETHER_USERS) === -1) {
			users.viewRule = `(${users.viewRule})${SUFFIX}`;
			app.save(users);
		}
	},
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		const rule = users.viewRule || '';
		if (rule.startsWith('(') && rule.endsWith(`)${SUFFIX}`)) {
			users.viewRule = rule.slice(1, -(SUFFIX.length + 1));
			app.save(users);
		}
		for (const name of ['together_comments', 'together']) {
			try {
				app.delete(app.findCollectionByNameOrId(name));
			} catch {
				// Schon weg -- nichts zu tun.
			}
		}
	}
);
