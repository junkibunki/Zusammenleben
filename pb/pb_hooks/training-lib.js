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

/** "Bankdrücken, Kniebeuge und 2 weitere" -- der Inhalt der Meldung. */
function exerciseSummary(app, userId) {
	const exercises = app.findRecordsByFilter(
		'training_exercises',
		'user = {:uid}',
		'sort,created',
		50,
		0,
		{ uid: userId }
	);
	const names = exercises.map((e) => e.getString('name'));
	if (names.length === 0) return 'Zeit fürs Training.';
	if (names.length <= 3) return names.join(', ');
	return `${names.slice(0, 2).join(', ')} und ${names.length - 2} weitere`;
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

		try {
			plan.set('reminded_on', t.date);
			app.save(plan);

			const userId = plan.getString('user');
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
				body: exerciseSummary(app, userId),
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
