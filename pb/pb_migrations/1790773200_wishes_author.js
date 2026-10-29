/// <reference path="../pb_data/types.d.ts" />

// Ideen fuer andere: wer einen Wunsch eintraegt, muss nicht mehr der sein,
// dem er gilt. `wisher` bleibt die Person, *fuer* die er ist (und die ihn nie
// sieht), `author` ist neu und haelt fest, wer ihn notiert hat.
//
// * List-/ViewRule bleiben unveraendert `wisher != @request.auth.id`: eine
//   Idee fuer X sieht jeder im Haushalt ausser X -- also auch, wer sie notiert
//   hat. Genau das ist die Erinnerung.
// * CreateRule: `author` ist immer der Anfragende. `wisher` ist er selbst oder
//   ein *laufendes* Mitglied desselben Haushalts -- ueber einen eigenen Alias
//   `target`, denn es ist eine andere Mitgliedschaft als die eigene
//   (docs/pitfalls/mandanten.md).
// * Der Unique-Index nimmt `author` mit auf. Sonst wuerde ein eigener Wunsch
//   von X am Index scheitern, nur weil jemand dieselbe Idee schon fuer X
//   notiert hat -- und X erfuehre so von einer Idee, die X nie sehen soll.
//   Doppelte unter Ideen faengt der Hook ab (wishes.pb.js).
//
// Bestand: alle vorhandenen Wuensche hat sich ihr `wisher` selbst gewuenscht,
// `author = wisher`.

const ACTIVE = (a) =>
	`(@collection.memberships:${a}.until ?= "" || @collection.memberships:${a}.until ?> @now)`;

const memberOf = (field) =>
	'@request.auth.id != "" && ' +
	'@collection.memberships:mine.user ?= @request.auth.id && ' +
	`@collection.memberships:mine.household ?= ${field} && ` +
	ACTIVE('mine');

const TARGET_IN_HOUSEHOLD =
	'@collection.memberships:target.user ?= wisher && ' +
	'@collection.memberships:target.household ?= household && ' +
	ACTIVE('target');

const CREATE =
	`${memberOf('household')} && author = @request.auth.id && ` +
	`(wisher = @request.auth.id || (${TARGET_IN_HOUSEHOLD}))`;

const INDEX_NEW =
	'CREATE UNIQUE INDEX `idx_wishes_dedupe` ON `wishes` (`household`, `wisher`, `author`, `text_norm`)';
const INDEX_OLD =
	'CREATE UNIQUE INDEX `idx_wishes_dedupe` ON `wishes` (`household`, `wisher`, `text_norm`)';
const INDEX_CREATED = 'CREATE INDEX `idx_wishes_created` ON `wishes` (`created`)';

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		let wishes = app.findCollectionByNameOrId('wishes');
		if (!wishes.fields.getByName('author')) {
			wishes.fields.add(
				new RelationField({
					id: 'relation_wishes_author',
					name: 'author',
					required: false,
					collectionId: users.id,
					// Ein geloeschter Autor nimmt die Idee nicht mit: sie betrifft `wisher`.
					cascadeDelete: false,
					maxSelect: 1
				})
			);
			app.save(wishes);
		}

		app.db().newQuery("UPDATE wishes SET author = wisher WHERE author = '' OR author IS NULL").execute();

		// Erst nach dem Feld: PocketBase prueft Rule und Index beim Speichern.
		wishes = app.findCollectionByNameOrId('wishes');
		wishes.createRule = CREATE;
		wishes.indexes = [INDEX_NEW, INDEX_CREATED];
		app.save(wishes);
	},
	(app) => {
		// Ideen fuer andere haben nach dem Zuruecknehmen keinen Platz mehr: sie
		// saehen aus wie Wuensche, die sich `wisher` selbst notiert hat.
		app.db().newQuery('DELETE FROM wishes WHERE author != wisher').execute();

		const wishes = app.findCollectionByNameOrId('wishes');
		wishes.createRule = `${memberOf('household')} && wisher = @request.auth.id`;
		wishes.indexes = [INDEX_OLD, INDEX_CREATED];
		if (wishes.fields.getByName('author')) wishes.fields.removeByName('author');
		app.save(wishes);
	}
);
