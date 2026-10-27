/// <reference path="../pb_data/types.d.ts" />

// Personen folgen (Trainings-Feed): wer jemandem folgt, bekommt eine
// Push-Meldung, sobald die Person ein Training veroeffentlicht hat -- also
// sobald ihr Feed-Beitrag des Tages entsteht (pb_hooks/training.pb.js).
//
// * `training_follows` -- eine Zeile pro Folgender und Gefolgtem, eindeutig.
//   Jeder sieht und loescht nur die eigenen (`follower = @request.auth.id`).
//   Folgen kann man nur, wer Training eingeschaltet hat (`users.show_training`),
//   und nicht sich selbst. Aendern gibt es nicht: entfolgen heisst loeschen.
// * `users`: damit sich *alle* Accounts mit eingeschaltetem Training finden
//   lassen (auch aus anderen Haushalten), oeffnet die ListRule fuer
//   `show_training = true`; die ViewRule dazu, sonst bliebe `expand` leer.
//   Zusaetzlich bleibt sichtbar, wem man folgt -- auch wenn die Person Training
//   spaeter wieder ausschaltet, sonst stuende in der eigenen Liste "Jemand".
//   Beides ueber denselben Alias `f`, damit `follower` und `followed` dieselbe
//   Zeile meinen (docs/pitfalls/mandanten.md).

const FOLLOW_USERS =
	'(@request.auth.id != "" && (show_training = true || ' +
	'(@collection.training_follows:f.follower ?= @request.auth.id && @collection.training_follows:f.followed ?= id)))';
const SUFFIX = ` || ${FOLLOW_USERS}`;

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');

		const follows = new Collection({
			type: 'base',
			name: 'training_follows',
			listRule: 'follower = @request.auth.id',
			viewRule: 'follower = @request.auth.id',
			createRule:
				'@request.auth.id != "" && follower = @request.auth.id && followed != @request.auth.id && followed.show_training = true',
			updateRule: null,
			deleteRule: 'follower = @request.auth.id',
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
				{
					name: 'follower',
					type: 'relation',
					required: true,
					collectionId: users.id,
					cascadeDelete: true,
					maxSelect: 1
				},
				{
					name: 'followed',
					type: 'relation',
					required: true,
					collectionId: users.id,
					cascadeDelete: true,
					maxSelect: 1
				},
				{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false }
			],
			indexes: [
				'CREATE UNIQUE INDEX `idx_training_follows_pair` ON `training_follows` (`follower`, `followed`)',
				'CREATE INDEX `idx_training_follows_followed` ON `training_follows` (`followed`)'
			]
		});
		app.save(follows);

		// Erst nach dem Anlegen: die Rule verweist auf `training_follows`, und
		// PocketBase prueft sie beim Speichern.
		let changed = false;
		for (const key of ['listRule', 'viewRule']) {
			if (users[key] && users[key].indexOf(FOLLOW_USERS) === -1) {
				users[key] = `(${users[key]})${SUFFIX}`;
				changed = true;
			}
		}
		if (changed) app.save(users);
	},
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		let changed = false;
		for (const key of ['listRule', 'viewRule']) {
			const rule = users[key] || '';
			if (rule.startsWith('(') && rule.endsWith(`)${SUFFIX}`)) {
				users[key] = rule.slice(1, -(SUFFIX.length + 1));
				changed = true;
			}
		}
		if (changed) app.save(users);
		try {
			app.delete(app.findCollectionByNameOrId('training_follows'));
		} catch {
			// Schon weg -- nichts zu tun.
		}
	}
);
