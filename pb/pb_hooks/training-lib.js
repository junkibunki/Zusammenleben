/// <reference path="../pb_data/types.d.ts" />

// Erinnerung an das Training (Migration 1789563600): an den gewaehlten
// Wochentagen zur gewaehlten Uhrzeit eine Push-Meldung an die *eigenen* Geraete.
//
// Eigenes Modul aus demselben Grund wie push-lib.js: ein Hook-Callback sieht den
// Modulscope seiner Datei nicht.

const pushLib = require(`${__hooks}/push-lib.js`);

// getUTCDay() -> Wert im select-Feld `days`.
const WEEKDAYS = ['so', 'mo', 'di', 'mi', 'do', 'fr', 'sa'];

// So lange nach der eingestellten Uhrzeit wird eine verpasste Erinnerung noch
// nachgeholt -- etwa wenn der Server gerade neu gestartet ist. Danach waere
// sie eher verwirrend als hilfreich.
const CATCH_UP_MINUTES = 30;

/** Millisekunden des letzten Sonntags im Monat `month` (0-basiert), 01:00 UTC. */
function lastSunday(year, month) {
	const last = new Date(Date.UTC(year, month + 1, 0));
	return Date.UTC(year, month, last.getUTCDate() - last.getUTCDay(), 1);
}

function pad(n) {
	return n < 10 ? `0${n}` : String(n);
}

/**
 * Wochentag, Datum und Uhrzeit in deutscher Zeit.
 *
 * Von Hand statt ueber `Intl`/die Zeitzone des Prozesses: `Intl` ist in der
 * JS-VM nicht verlaesslich da, und der Server laeuft in UTC. Die Sommerzeit
 * gilt in der EU vom letzten Sonntag im Maerz bis zum letzten Sonntag im
 * Oktober, jeweils 01:00 UTC.
 */
function berlin(ms) {
	const year = new Date(ms).getUTCFullYear();
	const summer = ms >= lastSunday(year, 2) && ms < lastSunday(year, 9);
	const local = new Date(ms + (summer ? 2 : 1) * 3600000);
	return {
		day: WEEKDAYS[local.getUTCDay()],
		date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
		minutes: local.getUTCHours() * 60 + local.getUTCMinutes()
	};
}

/** "HH:MM" -> Minuten seit Mitternacht; -1, wenn keine gueltige Uhrzeit. */
function toMinutes(text) {
	const m = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(text || '');
	return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
}

/**
 * Das Training, das als naechstes dran ist: das nach dem zuletzt eingetragenen,
 * in der Reihenfolge der Einstellungen (Push -> Pull -> Beine -> Push). Ohne
 * Verlauf das erste. Ist fuer `today` schon etwas eingetragen, ist es dessen
 * Training. Dieselbe Regel wie die Vorauswahl in training.svelte.js.
 */
function nextWorkout(app, userId, today) {
	const workouts = app.findRecordsByFilter(
		'training_workouts',
		'user = {:uid}',
		'sort,created',
		50,
		0,
		{ uid: userId }
	);
	if (workouts.length === 0) return null;

	const last = app.findRecordsByFilter('training_logs', 'user = {:uid}', '-date,-created', 1, 0, {
		uid: userId
	});
	if (last.length === 0) return workouts[0];

	let lastWorkout = '';
	try {
		lastWorkout = app
			.findRecordById('training_exercises', last[0].getString('exercise'))
			.getString('workout');
	} catch {
		// Uebung geloescht -- dann eben von vorn.
	}
	let idx = -1;
	for (let i = 0; i < workouts.length; i++) {
		if (workouts[i].id === lastWorkout) idx = i;
	}
	if (idx > -1 && last[0].getString('date') === today) return workouts[idx];
	return workouts[(idx + 1) % workouts.length];
}

/** Haengt "Training" im Profil im Menue? Ausgeblendet heisst: keine Erinnerung. */
function wantsTraining(app, userId) {
	try {
		return app.findRecordById('users', userId).getBool('show_training');
	} catch {
		return false;
	}
}

/**
 * Schickt alle faelligen Erinnerungen. Laeuft jede Minute; `now` nur fuer Tests.
 *
 * Faellig ist ein Plan, wenn heute einer seiner Tage ist, die Uhrzeit erreicht
 * ist (hoechstens CATCH_UP_MINUTES her) und heute noch keine kam. `reminded_on`
 * wird *vor* dem Versand gesetzt: lieber einmal keine Meldung als jede Minute
 * eine, falls das Senden wirft.
 */
function sendDueReminders(app, now) {
	const t = berlin(now === undefined ? Date.now() : now);
	const plans = app.findRecordsByFilter(
		'training_plans',
		'remind_at != "" && reminded_on != {:today}',
		'',
		500,
		0,
		{ today: t.date }
	);

	let sent = 0;
	for (let i = 0; i < plans.length; i++) {
		const plan = plans[i];
		if (plan.getStringSlice('days').indexOf(t.day) === -1) continue;

		const at = toMinutes(plan.getString('remind_at'));
		if (at < 0 || t.minutes < at || t.minutes - at > CATCH_UP_MINUTES) continue;

		const userId = plan.getString('user');
		if (!wantsTraining(app, userId)) continue;

		try {
			plan.set('reminded_on', t.date);
			app.save(plan);

			const next = nextWorkout(app, userId, t.date);
			const subscriptions = app.findRecordsByFilter(
				'push_subscriptions',
				'user = {:uid}',
				'-created',
				50,
				0,
				{ uid: userId }
			);
			sent += pushLib.broadcast(app, subscriptions, {
				title: 'Heute ist Training',
				body: next ? `Dran ist: ${next.getString('name')}` : 'Zeit fürs Training.',
				// Ein Tag pro Tag: eine Wiederholung durch den Push-Dienst ergibt
				// keine zweite Meldung.
				tag: `einkauf-training-${t.date}`,
				url: '/training'
			});
		} catch (err) {
			app.logger().warn('Trainingserinnerung fehlgeschlagen', 'plan', plan.id, 'fehler', String(err));
		}
	}
	return sent;
}

module.exports = { berlin, sendDueReminders };
