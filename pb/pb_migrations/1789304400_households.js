/// <reference path="../pb_data/types.d.ts" />

// Mehrere Haushalte (Mandanten).
//
// `households` ist nur ein Name. Wer wohin gehoert, steht in `memberships`:
// eine Zeile pro Person und Haushalt, Rolle "haupt" oder "gast". Gepflegt wird
// beides vom Superuser im Admin-UI (`/_/`) -- alle Schreib-Rules sind `null`.
//
// * Hoechstens *ein* Haupthaushalt pro Person: der partielle Unique-Index
//   `idx_memberships_main`. Das steht in der Datenbank, nicht in einem Hook,
//   und haelt deshalb auch gegen zwei gleichzeitige Saves.
// * Gast in beliebig vielen Haushalten, befristet ueber `until`. Leer heisst:
//   bis der Superuser die Zeile loescht. Abgelaufene Zeilen bleiben stehen --
//   sie oeffnen nichts mehr (siehe ACTIVE), halten aber die Namen in alten
//   Ausgaben lesbar.
//
// Eingeteilt werden Einkaufszettel, Ausgaben, Wuensche und Gundulas Standort:
// jede Zeile bekommt ein Pflichtfeld `household`, und jede Rule verlangt eine
// laufende Mitgliedschaft in genau diesem Haushalt. Der Ideen-Feed bleibt
// app-weit -- er betrifft die App selbst, nicht einen Haushalt.
//
// Bestand: alles Vorhandene landet in einem Haushalt "Zuhause", alle
// vorhandenen Accounts werden dort Haupt-Mitglied. Auch auf einer frischen
// Datenbank legt die Migration ihn an -- Gundulas Record (1756000020) gibt es
// dort ebenfalls schon, und er braucht einen Haushalt.

// Rules zum Nachschlagen, alle ueber denselben Alias `mine`: mehrere
// Bedingungen auf *einem* Alias treffen dieselbe Zeile. Sonst koennte das
// `until` aus der einen Mitgliedschaft und der Haushalt aus einer anderen
// stammen (docs/pitfalls/mandanten.md).
const ACTIVE = (a) =>
	`(@collection.memberships:${a}.until ?= "" || @collection.memberships:${a}.until ?> @now)`;

/** Angemeldet und laufendes Mitglied des Haushalts in `field`. */
const memberOf = (field) =>
	'@request.auth.id != "" && ' +
	'@collection.memberships:mine.user ?= @request.auth.id && ' +
	`@collection.memberships:mine.household ?= ${field} && ` +
	ACTIVE('mine');

// Ein Record wandert nicht in einen anderen Haushalt. Beim Teil-Update fehlt
// das Feld im Body; nur wenn es mitkommt, muss es gleich bleiben.
const KEEP_HOUSEHOLD =
	'(@request.body.household:isset = false || @request.body.household = household)';

// Wen darf ich sehen? Mich selbst und jeden, der in einem Haushalt steht, in
// dem ich *laufend* Mitglied bin. Die Mitgliedschaft des anderen darf
// abgelaufen sein: ein ehemaliger Gast bleibt in den Ausgaben, die er
// mitbezahlt hat, und dort soll sein Name stehen.
const CO_MEMBER =
	'@collection.memberships:theirs.user ?= id && ' +
	'@collection.memberships:mine.user ?= @request.auth.id && ' +
	'@collection.memberships:mine.household ?= @collection.memberships:theirs.household && ' +
	ACTIVE('mine');

const DATA = ['items', 'expenses', 'wishes', 'car_location'];

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

		// Erst ohne Rules: die verweisen auf `memberships`, und die gibt es noch
		// nicht -- PocketBase prueft die Rule beim Speichern.
		const households = new Collection({
			type: 'base',
			name: 'households',
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields: [
				idField,
				{ name: 'name', type: 'text', required: true, max: 80 },
				{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
				{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
			]
		});
		app.save(households);

		const memberships = new Collection({
			type: 'base',
			name: 'memberships',
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields: [
				idField,
				{
					name: 'user',
					type: 'relation',
					required: true,
					collectionId: users.id,
					cascadeDelete: true,
					maxSelect: 1
				},
				{
					name: 'household',
					type: 'relation',
					required: true,
					collectionId: households.id,
					cascadeDelete: true,
					maxSelect: 1
				},
				{
					name: 'role',
					type: 'select',
					required: true,
					maxSelect: 1,
					values: ['haupt', 'gast']
				},
				// Nur fuer Gaeste; households.pb.js weist ein Enddatum an einer
				// Haupt-Mitgliedschaft ab.
				{ name: 'until', type: 'date', required: false },
				{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
				{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
			],
			indexes: [
				'CREATE UNIQUE INDEX `idx_memberships_pair` ON `memberships` (`user`, `household`)',
				"CREATE UNIQUE INDEX `idx_memberships_main` ON `memberships` (`user`) WHERE `role` = 'haupt'",
				'CREATE INDEX `idx_memberships_household` ON `memberships` (`household`)'
			]
		});
		app.save(memberships);

		households.listRule = memberOf('id');
		households.viewRule = memberOf('id');
		app.save(households);

		// Die eigenen Zeilen (auch abgelaufene -- der Client sortiert die aus)
		// und alle Zeilen der Haushalte, in denen ich laufend Mitglied bin: die
		// Seite "Bewohner" liest daraus, wer dazugehoert.
		const ownOrShared = `@request.auth.id != "" && (user = @request.auth.id || (${memberOf('household')}))`;
		memberships.listRule = ownOrShared;
		memberships.viewRule = ownOrShared;
		app.save(memberships);

		// Bisher sah jeder Eingeloggte jeden Account (1756000002/1756000004).
		// Jetzt nur noch die Mitbewohner -- plus, beim Einzelabruf, wer im
		// app-weiten Ideen-Feed geschrieben oder abgehakt hat: sonst stuende dort
		// bei Leuten aus anderen Haushalten nur "Jemand".
		users.listRule = `@request.auth.id != "" && (id = @request.auth.id || (${CO_MEMBER}))`;
		users.viewRule =
			`@request.auth.id != "" && (id = @request.auth.id || (${CO_MEMBER}) || ` +
			'@collection.ideas.author ?= id || @collection.ideas.resolved_by ?= id)';
		app.save(users);

		// Bestand in einen Haushalt.
		const home = new Record(households);
		home.set('name', 'Zuhause');
		app.save(home);

		for (const user of app.findAllRecords('users')) {
			const m = new Record(memberships);
			m.set('user', user.id);
			m.set('household', home.id);
			m.set('role', 'haupt');
			app.save(m);
		}

		for (const name of DATA) {
			const collection = app.findCollectionByNameOrId(name);
			collection.fields.add(
				new RelationField({
					name: 'household',
					required: true,
					collectionId: households.id,
					// Ein Haushalt, den der Superuser loescht, nimmt seine Daten mit.
					cascadeDelete: true,
					maxSelect: 1
				})
			);
			app.save(collection);
			app.db()
				.newQuery(`UPDATE ${name} SET household = {:h} WHERE household = '' OR household IS NULL`)
				.bind({ h: home.id })
				.execute();
		}

		const member = memberOf('household');

		const items = app.findCollectionByNameOrId('items');
		items.listRule = member;
		items.viewRule = member;
		items.createRule = member;
		items.updateRule = `${member} && ${KEEP_HOUSEHOLD}`;
		items.deleteRule = member;
		items.indexes = [
			'CREATE INDEX `idx_items_done` ON `items` (`done`)',
			'CREATE INDEX `idx_items_household` ON `items` (`household`)'
		];
		app.save(items);

		const expenses = app.findCollectionByNameOrId('expenses');
		expenses.listRule = member;
		expenses.viewRule = member;
		expenses.createRule = `${member} && @request.body.amount_cents != 0`;
		expenses.updateRule = `${member} && ${KEEP_HOUSEHOLD}`;
		expenses.deleteRule = member;
		expenses.indexes = [
			'CREATE INDEX `idx_expenses_created` ON `expenses` (`created`)',
			'CREATE INDEX `idx_expenses_household` ON `expenses` (`household`)'
		];
		app.save(expenses);

		// Der Doppel-Schutz gilt pro Haushalt: derselbe Wunsch darf in zwei
		// Haushalten stehen, die voneinander nichts sehen.
		const wishes = app.findCollectionByNameOrId('wishes');
		wishes.listRule = `${member} && wisher != @request.auth.id`;
		wishes.viewRule = `${member} && wisher != @request.auth.id`;
		wishes.createRule = `${member} && wisher = @request.auth.id`;
		wishes.indexes = [
			'CREATE UNIQUE INDEX `idx_wishes_dedupe` ON `wishes` (`household`, `wisher`, `text_norm`)',
			'CREATE INDEX `idx_wishes_created` ON `wishes` (`created`)'
		];
		app.save(wishes);

		// Gundula: ein Record pro Haushalt, die ID *ist* die des Haushalts --
		// so kennt der Client sie, ohne zu suchen. Neue Haushalte bekommen ihren
		// Record von households.pb.js.
		app.db()
			.newQuery("UPDATE car_location SET id = {:h} WHERE id = 'gundula'")
			.bind({ h: home.id })
			.execute();
		const car = app.findCollectionByNameOrId('car_location');
		car.listRule = member;
		car.viewRule = member;
		car.updateRule = `${member} && ${KEEP_HOUSEHOLD}`;
		car.indexes = [
			'CREATE UNIQUE INDEX `idx_car_location_household` ON `car_location` (`household`)'
		];
		app.save(car);
	},
	(app) => {
		// Zurueck auf *einen* Haushalt: der aelteste bleibt, die Daten aller
		// anderen gehen verloren -- zusammengelegt kollidierten sie (Gundula gaebe
		// es mehrfach, Wuensche verletzten den alten Unique-Index).
		const loggedIn = '@request.auth.id != ""';
		const list = app.findRecordsByFilter('households', '', 'created', 1, 0);
		const keep = list.length > 0 ? list[0].id : '';

		for (const name of DATA) {
			app.db()
				.newQuery(`DELETE FROM ${name} WHERE household != {:h}`)
				.bind({ h: keep })
				.execute();
		}
		app.db()
			.newQuery("UPDATE car_location SET id = 'gundula' WHERE id = {:h}")
			.bind({ h: keep })
			.execute();

		const items = app.findCollectionByNameOrId('items');
		items.listRule = loggedIn;
		items.viewRule = loggedIn;
		items.createRule = loggedIn;
		items.updateRule = loggedIn;
		items.deleteRule = loggedIn;
		items.indexes = ['CREATE INDEX `idx_items_done` ON `items` (`done`)'];
		items.fields.removeByName('household');
		app.save(items);

		const expenses = app.findCollectionByNameOrId('expenses');
		expenses.listRule = loggedIn;
		expenses.viewRule = loggedIn;
		expenses.createRule = `${loggedIn} && @request.body.amount_cents != 0`;
		expenses.updateRule = loggedIn;
		expenses.deleteRule = loggedIn;
		expenses.indexes = ['CREATE INDEX `idx_expenses_created` ON `expenses` (`created`)'];
		expenses.fields.removeByName('household');
		app.save(expenses);

		const notMine = `${loggedIn} && wisher != @request.auth.id`;
		const wishes = app.findCollectionByNameOrId('wishes');
		wishes.listRule = notMine;
		wishes.viewRule = notMine;
		wishes.createRule = `${loggedIn} && wisher = @request.auth.id`;
		wishes.indexes = [
			'CREATE UNIQUE INDEX `idx_wishes_dedupe` ON `wishes` (`wisher`, `text_norm`)',
			'CREATE INDEX `idx_wishes_created` ON `wishes` (`created`)'
		];
		wishes.fields.removeByName('household');
		app.save(wishes);

		const car = app.findCollectionByNameOrId('car_location');
		car.listRule = loggedIn;
		car.viewRule = loggedIn;
		car.updateRule = loggedIn;
		car.indexes = [];
		car.fields.removeByName('household');
		app.save(car);

		const users = app.findCollectionByNameOrId('users');
		users.listRule = loggedIn;
		users.viewRule = loggedIn;
		app.save(users);

		app.delete(app.findCollectionByNameOrId('memberships'));
		app.delete(app.findCollectionByNameOrId('households'));
	}
);
