/// <reference path="../pb_data/types.d.ts" />

// Training, zweite Ausbaustufe.
//
// * `training_logs.sets`  -- die Saetze eines Tages als JSON-Liste
//                            `[{ weight, reps, seconds, warmup }]`. Geprueft und
//                            normalisiert in pb_hooks/training.pb.js; `weight`
//                            bleibt als abgeleitetes Arbeitsgewicht (schwerster
//                            Arbeitssatz) stehen, damit Verlauf, Bestwerte und
//                            "Letztes Mal" nicht jedes JSON lesen muessen.
// * `training_logs.note`  -- Notiz pro Uebung und Tag.
// * `training_exercises`  -- `kind` (weight | bodyweight | time; leer = weight),
//                            `reps_max` (Obergrenze eines Wdh.-Bereichs, 0 = keiner),
//                            `rest` (Satzpause in s, 0 = kein Timer) und
//                            `increment` (Steigerung in kg, 0 = kein Vorschlag).
//                            Bei `kind = time` stehen in `reps`/`reps_max` Sekunden,
//                            deshalb die Obergrenze 3600.
// * `training_sessions`   -- ein Datensatz pro Person und Tag mit der Dauer.
// * `training_bodyweight` -- Koerpergewicht, ein Wert pro Person und Tag.
//
// Bestand: jeder alte Eintrag wird zu `sets` Saetzen mit seinem Gewicht. Die
// Wdh. bleiben leer -- erfasst wurden sie nie, und ein erfundenes "Soll
// geschafft" loeste beim ersten Training danach ueberall den
// Steigerungsvorschlag aus.

const KINDS = ['weight', 'bodyweight', 'time'];
const DEFAULT_REST = 90;
const DEFAULT_INCREMENT = 2.5;

const OWN = 'user = @request.auth.id';
const CREATE_OWN = '@request.auth.id != "" && @request.body.user = @request.auth.id';
const KEEP_USER = '(@request.body.user:isset = false || @request.body.user = user)';
const OWN_WORKOUT =
	'(@request.body.workout:isset = false || @request.body.workout = "" || (' +
	'@collection.training_workouts:wk.id ?= @request.body.workout && ' +
	'@collection.training_workouts:wk.user ?= @request.auth.id))';
const DATE = { type: 'text', required: true, max: 10, pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' };

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

		// --- Uebungen --------------------------------------------------------
		const exercises = app.findCollectionByNameOrId('training_exercises');
		if (!exercises.fields.getByName('kind')) {
			exercises.fields.add(
				new SelectField({
					id: 'select_training_exercises_kind',
					name: 'kind',
					required: false,
					maxSelect: 1,
					values: KINDS
				})
			);
		}
		if (!exercises.fields.getByName('reps_max')) {
			exercises.fields.add(
				new NumberField({
					id: 'number_training_exercises_reps_max',
					name: 'reps_max',
					required: false,
					onlyInt: true,
					min: 0,
					max: 3600
				})
			);
		}
		if (!exercises.fields.getByName('rest')) {
			exercises.fields.add(
				new NumberField({
					id: 'number_training_exercises_rest',
					name: 'rest',
					required: false,
					onlyInt: true,
					min: 0,
					max: 900
				})
			);
		}
		if (!exercises.fields.getByName('increment')) {
			exercises.fields.add(
				new NumberField({
					id: 'number_training_exercises_increment',
					name: 'increment',
					required: false,
					min: 0,
					max: 50
				})
			);
		}
		const reps = exercises.fields.getByName('reps');
		if (reps) reps.max = 3600;
		app.save(exercises);

		app
			.db()
			.newQuery(
				`UPDATE training_exercises SET rest = ${DEFAULT_REST}, increment = ${DEFAULT_INCREMENT} WHERE rest IS NULL OR rest = 0`
			)
			.execute();

		// --- Eintraege -------------------------------------------------------
		const logs = app.findCollectionByNameOrId('training_logs');
		if (!logs.fields.getByName('sets')) {
			logs.fields.add(
				new JSONField({ id: 'json_training_logs_sets', name: 'sets', required: false, maxSize: 8000 })
			);
		}
		if (!logs.fields.getByName('note')) {
			logs.fields.add(
				new TextField({ id: 'text_training_logs_note', name: 'note', required: false, max: 500 })
			);
		}
		app.save(logs);

		const setCount = {};
		for (const ex of app.findAllRecords('training_exercises')) {
			setCount[ex.id] = ex.getInt('sets') || 1;
		}
		for (const log of app.findAllRecords('training_logs')) {
			const raw = log.getString('sets');
			if (raw && raw !== 'null' && raw !== '[]') continue;
			const n = setCount[log.getString('exercise')] || 1;
			const sets = [];
			for (let i = 0; i < n; i++) {
				sets.push({ weight: log.getFloat('weight'), reps: null, seconds: null, warmup: false });
			}
			log.set('sets', sets);
			app.saveNoValidate(log);
		}

		// --- Trainingstage mit Dauer ----------------------------------------
		const workouts = app.findCollectionByNameOrId('training_workouts');
		const sessions = new Collection({
			type: 'base',
			name: 'training_sessions',
			listRule: OWN,
			viewRule: OWN,
			createRule: `${CREATE_OWN} && ${OWN_WORKOUT}`,
			updateRule: `${OWN} && ${KEEP_USER} && ${OWN_WORKOUT}`,
			deleteRule: OWN,
			fields: [
				idField,
				userField,
				{ name: 'date', ...DATE },
				// Kein cascadeDelete: die Dauer bleibt, auch wenn das Training weg ist.
				{
					name: 'workout',
					type: 'relation',
					required: false,
					collectionId: workouts.id,
					cascadeDelete: false,
					maxSelect: 1
				},
				// Sekunden.
				{ name: 'duration', type: 'number', required: false, onlyInt: true, min: 0, max: 86400 },
				...timestamps
			],
			indexes: [
				'CREATE UNIQUE INDEX `idx_training_sessions_day` ON `training_sessions` (`user`, `date`)'
			]
		});
		app.save(sessions);

		// --- Koerpergewicht --------------------------------------------------
		const bodyweight = new Collection({
			type: 'base',
			name: 'training_bodyweight',
			listRule: OWN,
			viewRule: OWN,
			createRule: CREATE_OWN,
			updateRule: `${OWN} && ${KEEP_USER}`,
			deleteRule: OWN,
			fields: [
				idField,
				userField,
				{ name: 'date', ...DATE },
				{ name: 'weight', type: 'number', required: true, min: 20, max: 400 },
				...timestamps
			],
			indexes: [
				'CREATE UNIQUE INDEX `idx_training_bodyweight_day` ON `training_bodyweight` (`user`, `date`)'
			]
		});
		app.save(bodyweight);
	},
	(app) => {
		for (const name of ['training_bodyweight', 'training_sessions']) {
			try {
				app.delete(app.findCollectionByNameOrId(name));
			} catch {
				// Schon weg -- nichts zu tun.
			}
		}
		const logs = app.findCollectionByNameOrId('training_logs');
		logs.fields.removeByName('sets');
		logs.fields.removeByName('note');
		app.save(logs);

		const exercises = app.findCollectionByNameOrId('training_exercises');
		for (const name of ['kind', 'reps_max', 'rest', 'increment']) exercises.fields.removeByName(name);
		app.save(exercises);
	}
);
