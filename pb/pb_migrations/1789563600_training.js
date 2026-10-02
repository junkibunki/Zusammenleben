/// <reference path="../pb_data/types.d.ts" />

// Training: ein Trainingsplan pro Person, nicht pro Haushalt.
//
// * `training_plans`   -- genau ein Datensatz pro Person: an welchen Wochentagen
//                         trainiert wird und um wie viel Uhr die Erinnerung kommt.
// * `training_exercises` -- die Uebungen des Plans mit Saetzen x Wiederholungen.
// * `training_logs`    -- das tatsaechlich geschaffte Gewicht, eine Zeile pro
//                         Uebung und Trainingstag.
//
// Alles ist privat: jede Rule steht auf `user = @request.auth.id`, auch die
// anderen Mitglieder des Haushalts sehen nichts davon.
//
// Erinnert wird serverseitig aus einem Cron-Job (pb_hooks/training.pb.js).
// `reminded_on` schreibt nur der Server; es verhindert eine zweite Meldung am
// selben Tag.

const NAME_MAX = 60;
const DAYS = ['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so'];

const OWN = 'user = @request.auth.id';
const CREATE_OWN = '@request.auth.id != "" && @request.body.user = @request.auth.id';
const KEEP_USER = '(@request.body.user:isset = false || @request.body.user = user)';

// Ein Eintrag darf nur auf eine eigene Uebung zeigen. Eigener Alias `ex`,
// damit ID und Besitzer dieselbe Zeile treffen.
const OWN_EXERCISE =
	'@collection.training_exercises:ex.id ?= @request.body.exercise && ' +
	'@collection.training_exercises:ex.user ?= @request.auth.id';
const KEEP_EXERCISE = '(@request.body.exercise:isset = false || @request.body.exercise = exercise)';

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

const timestamps = [
	{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
	{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
];

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		const userField = {
			name: 'user',
			type: 'relation',
			required: true,
			collectionId: users.id,
			cascadeDelete: true,
			maxSelect: 1
		};

		const plans = new Collection({
			type: 'base',
			name: 'training_plans',
			listRule: OWN,
			viewRule: OWN,
			// `reminded_on` gehoert dem Cron-Job; ein Client, der es setzt, koennte
			// die Erinnerung fuer heute unterdruecken oder erneut ausloesen.
			createRule: `${CREATE_OWN} && @request.body.reminded_on:isset = false`,
			updateRule: `${OWN} && ${KEEP_USER} && @request.body.reminded_on:isset = false`,
			deleteRule: OWN,
			fields: [
				idField,
				userField,
				{ name: 'days', type: 'select', required: false, maxSelect: DAYS.length, values: DAYS },
				// Uhrzeit in deutscher Zeit, "HH:MM" -- so liefert sie <input type="time">.
				{
					name: 'remind_at',
					type: 'text',
					required: false,
					max: 5,
					pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$'
				},
				// Tag der letzten Erinnerung, "YYYY-MM-DD" in deutscher Zeit.
				{ name: 'reminded_on', type: 'text', required: false, max: 10 },
				...timestamps
			],
			indexes: ['CREATE UNIQUE INDEX `idx_training_plans_user` ON `training_plans` (`user`)']
		});
		app.save(plans);

		const exercises = new Collection({
			type: 'base',
			name: 'training_exercises',
			listRule: OWN,
			viewRule: OWN,
			createRule: CREATE_OWN,
			updateRule: `${OWN} && ${KEEP_USER}`,
			deleteRule: OWN,
			fields: [
				idField,
				userField,
				// `pattern`: `required` allein liesse einen Namen aus Leerzeichen durch.
				{ name: 'name', type: 'text', required: true, max: NAME_MAX, pattern: '\\S' },
				{ name: 'sets', type: 'number', required: true, onlyInt: true, min: 1, max: 20 },
				{ name: 'reps', type: 'number', required: true, onlyInt: true, min: 1, max: 200 },
				// Reihenfolge im Plan; bei Gleichstand entscheidet `created`.
				{ name: 'sort', type: 'number', onlyInt: true },
				...timestamps
			]
		});
		app.save(exercises);

		const logs = new Collection({
			type: 'base',
			name: 'training_logs',
			listRule: OWN,
			viewRule: OWN,
			createRule: `${CREATE_OWN} && ${OWN_EXERCISE}`,
			updateRule: `${OWN} && ${KEEP_USER} && ${KEEP_EXERCISE}`,
			deleteRule: OWN,
			fields: [
				idField,
				userField,
				// Wird die Uebung geloescht, geht ihr Verlauf mit.
				{
					name: 'exercise',
					type: 'relation',
					required: true,
					collectionId: exercises.id,
					cascadeDelete: true,
					maxSelect: 1
				},
				{
					name: 'date',
					type: 'text',
					required: true,
					max: 10,
					pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
				},
				// Kilogramm. Nicht `required`: das wuerde 0 ablehnen, und 0 ist bei
				// einer Uebung mit dem eigenen Koerpergewicht ein echter Wert.
				{ name: 'weight', type: 'number', required: false, min: 0, max: 1000 },
				...timestamps
			],
			indexes: [
				'CREATE UNIQUE INDEX `idx_training_logs_day` ON `training_logs` (`exercise`, `date`)',
				'CREATE INDEX `idx_training_logs_user_date` ON `training_logs` (`user`, `date`)'
			]
		});
		app.save(logs);
	},
	(app) => {
		for (const name of ['training_logs', 'training_exercises', 'training_plans']) {
			try {
				app.delete(app.findCollectionByNameOrId(name));
			} catch {
				// Schon weg -- nichts zu tun.
			}
		}
	}
);
