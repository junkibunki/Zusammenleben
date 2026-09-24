/// <reference path="../pb_data/types.d.ts" />

// Kategorien ("Wo einkaufen?") pro Haushalt statt fester Liste.
//
// Bisher war `items.category` ein select-Feld mit vier festen Werten
// (1756000005). Jetzt legt jeder Haushalt seine Kategorien selbst an, benennt
// sie um, sortiert und loescht sie -- also eine eigene Collection, und
// `items.category` wird eine Relation darauf. Ein Umbenennen trifft damit
// sofort alle Eintraege, ohne dass jemand sie umschreibt.
//
// Wird eine Kategorie geloescht, leert PocketBase die Relation in den
// Eintraegen (nicht required, kein cascadeDelete); die Liste zeigt sie dann
// unter "Ohne Kategorie". Loeschen darf also nie Eintraege mitnehmen.
//
// Anlegen, umbenennen, sortieren und loeschen duerfen nur Haupt-Mitglieder;
// Gaeste sehen die Kategorien und nutzen sie auf dem Zettel.
//
// Bestand: jeder Haushalt bekommt die vier bisherigen Werte als Kategorien,
// und jeder Eintrag zeigt auf die gleichnamige seines Haushalts. Ein leerer
// Wert galt bisher als "Supermarkt" -- so bleibt er einsortiert.

const DEFAULTS = ['Supermarkt', 'Drogerie', 'Baumarkt', 'IKEA'];
const NAME_MAX = 40;

// Dieselben Bausteine wie in 1789304400 (docs/pitfalls/mandanten.md).
const ACTIVE = (a) =>
	`(@collection.memberships:${a}.until ?= "" || @collection.memberships:${a}.until ?> @now)`;

const memberOf = (field) =>
	'@request.auth.id != "" && ' +
	'@collection.memberships:mine.user ?= @request.auth.id && ' +
	`@collection.memberships:mine.household ?= ${field} && ` +
	ACTIVE('mine');

// Die Einstellungen eines Haushalts (Kategorien, Name des Autos) aendern nur
// Haupt-Mitglieder; Gaeste lesen sie nur. Derselbe Alias `mine` wie oben,
// damit Rolle, Haushalt und `until` aus *einer* Mitgliedschaft stammen.
const mainOf = (field) => `${memberOf(field)} && @collection.memberships:mine.role ?= "haupt"`;

const KEEP_HOUSEHOLD =
	'(@request.body.household:isset = false || @request.body.household = household)';

// Ein Eintrag darf nur auf eine Kategorie seines eigenen Haushalts zeigen.
// Eigener Alias `cat`, damit ID und Haushalt dieselbe Zeile treffen.
const categoryIn = (household) =>
	'(@request.body.category:isset = false || @request.body.category = "" || ' +
	'(@collection.categories:cat.id ?= @request.body.category && ' +
	`@collection.categories:cat.household ?= ${household}))`;

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
		const households = app.findCollectionByNameOrId('households');
		const member = memberOf('household');
		const main = mainOf('household');

		const categories = new Collection({
			type: 'base',
			name: 'categories',
			listRule: member,
			viewRule: member,
			createRule: main,
			updateRule: `${main} && ${KEEP_HOUSEHOLD}`,
			deleteRule: main,
			fields: [
				idField,
				{
					name: 'household',
					type: 'relation',
					required: true,
					collectionId: households.id,
					cascadeDelete: true,
					maxSelect: 1
				},
				// `pattern`: `required` allein liesse einen Namen aus Leerzeichen durch.
				{ name: 'name', type: 'text', required: true, max: NAME_MAX, pattern: '\\S' },
				// Reihenfolge auf dem Zettel; bei Gleichstand entscheidet `created`.
				{ name: 'sort', type: 'number', onlyInt: true },
				{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
				{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
			],
			indexes: [
				// "IKEA" und "ikea" im selben Haushalt waeren zwei Gruppen, die
				// niemand auseinanderhaelt.
				'CREATE UNIQUE INDEX `idx_categories_name` ON `categories` (`household`, `name` COLLATE NOCASE)'
			]
		});
		app.save(categories);

		// Den Namen des Autos darf ein Haupt-Mitglied selbst aendern (Seite
		// "Haushalt-Einstellungen"); den Namen des Haushalts weiter nur der Superuser.
		households.updateRule =
			`${mainOf('id')} && (@request.body.name:isset = false || @request.body.name = name)`;
		app.save(households);

		// Nur Haushalte ohne Kategorien: auf einer frischen Datenbank hat der
		// Hook in households.pb.js noch nichts angelegt (die Collection gab es
		// da nicht), und ein zweiter Lauf soll nichts doppeln.
		for (const household of app.findAllRecords('households')) {
			const existing = app.findRecordsByFilter('categories', 'household = {:h}', '', 1, 0, {
				h: household.id
			});
			if (existing.length > 0) continue;
			DEFAULTS.forEach((name, i) => {
				const c = new Record(categories);
				c.set('household', household.id);
				c.set('name', name);
				c.set('sort', i);
				app.save(c);
			});
		}

		// select -> Relation: den Typ eines Feldes aendert PocketBase nicht.
		// Also das alte Feld umbenennen, das neue daneben anlegen, per SQL
		// umhaengen und das alte entfernen.
		let items = app.findCollectionByNameOrId('items');
		const old = items.fields.getByName('category');
		if (old && old.type() === 'select') {
			old.name = 'category_old';
			app.save(items);
			items = app.findCollectionByNameOrId('items');
		}

		// Eigene `id`, damit PocketBase das neue Feld nicht mit dem alten
		// verwechselt ("Field type cannot be changed").
		items.fields.add(
			new RelationField({
				id: 'relation_items_category',
				name: 'category',
				required: false,
				collectionId: categories.id,
				cascadeDelete: false,
				maxSelect: 1
			})
		);
		app.save(items);

		if (items.fields.getByName('category_old')) {
			app.db()
				.newQuery(
					'UPDATE items SET category = COALESCE((' +
						'SELECT c.id FROM categories c WHERE c.household = items.household AND ' +
						"c.name = CASE WHEN COALESCE(items.category_old, '') = '' THEN 'Supermarkt' ELSE items.category_old END" +
						"), '')"
				)
				.execute();
			items.fields.removeByName('category_old');
		}

		items.createRule = `${member} && ${categoryIn('@request.body.household')}`;
		items.updateRule = `${member} && ${KEEP_HOUSEHOLD} && ${categoryIn('household')}`;
		app.save(items);
	},
	(app) => {
		const member = memberOf('household');

		// Zurueck auf das feste select-Feld. Eigene Kategorien lassen sich dort
		// nicht abbilden; alles ausser "Drogerie", "Baumarkt" und "IKEA" wird
		// wieder "Supermarkt".
		let items = app.findCollectionByNameOrId('items');
		items.createRule = member;
		items.updateRule = `${member} && ${KEEP_HOUSEHOLD}`;

		const ref = items.fields.getByName('category');
		if (ref && ref.type() === 'relation') {
			ref.name = 'category_ref';
			app.save(items);
			items = app.findCollectionByNameOrId('items');
		}

		items.fields.add(
			new SelectField({ id: 'select_items_category', name: 'category', required: false, maxSelect: 1, values: DEFAULTS })
		);
		app.save(items);

		if (items.fields.getByName('category_ref')) {
			app.db()
				.newQuery(
					'UPDATE items SET category = COALESCE((' +
						"SELECT CASE WHEN c.name IN ('Drogerie', 'Baumarkt', 'IKEA') THEN c.name ELSE 'Supermarkt' END " +
						"FROM categories c WHERE c.id = items.category_ref), 'Supermarkt')"
				)
				.execute();
			items.fields.removeByName('category_ref');
			app.save(items);
		}

		app.delete(app.findCollectionByNameOrId('categories'));

		const households = app.findCollectionByNameOrId('households');
		households.updateRule = null;
		app.save(households);
	}
);
