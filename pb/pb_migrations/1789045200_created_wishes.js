/// <reference path="../pb_data/types.d.ts" />

// Collection "wishes" -- Geschenkewuensche ("Wuensch dir was").
//
// Der Witz der Seite steckt in den API-Rules: `wisher != @request.auth.id`.
// Wer einen Wunsch anlegt, bekommt ihn nie wieder zu sehen -- weder in der
// Liste, noch einzeln, noch ueber Realtime (PocketBase prueft die ListRule pro
// Abonnent). Das muss serverseitig stehen: filterte der Client, laege der
// Wunsch trotzdem in seinem Speicher, und der Sinn der Sache waere weg.
//
// `createRule` mit `wisher = @request.auth.id`: man wuenscht sich nur selbst
// etwas. Das ist die *einzige* Sperre dafuer und muss es sein -- die Rule laeuft
// vor den Request-Hooks, ein Hook koennte `wisher` also nicht mehr zurechtsetzen
// (docs/pitfalls/pocketbase-hooks.md). Der Client schickt das Feld deshalb mit.
//
// `update`/`deleteRule: null` (= nur Superuser): der Wunsch ist fuer den
// Anlegenden unsichtbar, er koennte ihn also gar nicht mehr bearbeiten -- und
// den Wunsch eines anderen loeschen zu duerfen waere schlimmer als ein Tippfehler,
// der stehen bleibt.
//
// `text_norm` ist die vergleichbare Form von `text` (siehe wishes.pb.js) und
// traegt den Doppel-Schutz: der Unique-Index ueber (`wisher`, `text_norm`) haelt
// auch dann, wenn zwei Requests gleichzeitig durchlaufen und die Abfrage im Hook
// noch nichts findet. Der Index meldet den Fehler dann unter `text_norm` statt
// unter `text` -- `wishErrorMessage()` im Store kennt beide Formen.
migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		const loggedIn = '@request.auth.id != ""';
		const notMine = `${loggedIn} && wisher != @request.auth.id`;

		const collection = new Collection({
			type: 'base',
			name: 'wishes',
			listRule: notMine,
			viewRule: notMine,
			createRule: `${loggedIn} && wisher = @request.auth.id`,
			updateRule: null,
			deleteRule: null,
			fields: [
				{
					name: 'id',
					type: 'text',
					system: true,
					primaryKey: true,
					required: true,
					min: 15,
					max: 15,
					pattern: '^[a-z0-9]+$',
					autogeneratePattern: '[a-z0-9]{15}'
				},
				{ name: 'text', type: 'text', required: true, max: 200 },
				// `hidden`: kommt in keiner API-Antwort vor und laesst sich nicht per
				// Request setzen. Es ist Buchhaltung fuer den Index, kein Inhalt.
				{ name: 'text_norm', type: 'text', required: false, max: 200, hidden: true },
				{
					name: 'wisher',
					type: 'relation',
					required: true,
					collectionId: users.id,
					// Ohne die Person ist der Wunsch gegenstandslos -- anders als bei
					// `ideas`, wo der Vorschlag die App auch ohne seinen Autor betrifft.
					cascadeDelete: true,
					maxSelect: 1
				},
				{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
				{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
			],
			indexes: [
				'CREATE UNIQUE INDEX `idx_wishes_dedupe` ON `wishes` (`wisher`, `text_norm`)',
				'CREATE INDEX `idx_wishes_created` ON `wishes` (`created`)'
			]
		});

		app.save(collection);
	},
	(app) => {
		app.delete(app.findCollectionByNameOrId('wishes'));
	}
);
