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

	// Der juengste Eintrag mit Saetzen; einer nur mit Notiz war kein Training.
	const recent = app.findRecordsByFilter('training_logs', 'user = {:uid}', '-date,-created', 50, 0, {
		uid: userId
	});
	const last = [];
	for (let i = 0; i < recent.length && last.length === 0; i++) {
		if (recent[i].getString('sets') !== '[]') last.push(recent[i]);
	}
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

/**
 * Steht fuer `date` schon ein Satz im Verlauf (oder eine Dauer)? Dann braucht es
 * keine Erinnerung mehr. Ein Eintrag nur mit Notiz zaehlt nicht als Training.
 */
function trainedOn(app, userId, date) {
	const params = { uid: userId, d: date };
	const logs = app.findRecordsByFilter('training_logs', 'user = {:uid} && date = {:d}', '', 100, 0, params);
	for (let i = 0; i < logs.length; i++) {
		const raw = logs[i].getString('sets');
		if (raw && raw !== 'null' && raw !== '[]') return true;
	}
	return (
		app.findRecordsByFilter('training_sessions', 'user = {:uid} && date = {:d}', '', 1, 0, params).length > 0
	);
}

const SETS_MAX = 30;

function num(value, min, max, int) {
	if (value === null || value === undefined || value === '') return null;
	const n = Number(value);
	if (!isFinite(n) || n < min || n > max) return NaN;
	if (int && Math.floor(n) !== n) return NaN;
	return n;
}

/**
 * Prueft `sets` eines Eintrags und leitet `weight` ab (schwerster Arbeitssatz,
 * sonst 0). Liefert eine Fehlermeldung oder '' -- werfen muss der Callback,
 * damit der Fehler als Feldfehler ankommt (docs/pitfalls/pocketbase-hooks.md).
 */
function normalizeLog(record) {
	let sets;
	try {
		sets = JSON.parse(record.getString('sets') || '[]');
	} catch {
		return 'Die Sätze sind kein gültiges JSON.';
	}
	if (sets === null) sets = [];
	if (!Array.isArray(sets)) return 'Die Sätze müssen eine Liste sein.';
	if (sets.length > SETS_MAX) return `Höchstens ${SETS_MAX} Sätze pro Übung.`;

	const clean = [];
	let top = 0;
	for (let i = 0; i < sets.length; i++) {
		const s = sets[i] || {};
		const weight = num(s.weight, 0, 1000, false);
		const reps = num(s.reps, 0, 1000, true);
		const seconds = num(s.seconds, 0, 36000, true);
		if ([weight, reps, seconds].some((v) => typeof v === 'number' && isNaN(v))) {
			return `Satz ${i + 1} hat einen ungültigen Wert.`;
		}
		if (weight === null && reps === null && seconds === null) continue;
		const warmup = s.warmup === true;
		clean.push({ weight, reps, seconds, warmup });
		if (!warmup && weight !== null && weight > top) top = weight;
	}
	record.set('sets', clean);
	record.set('weight', top);
	return '';
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
		// Wer morgens schon trainiert hat, bekommt abends keine Erinnerung mehr.
		if (trainedOn(app, userId, t.date)) continue;

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

// --- Feed (Migration 1789909200) --------------------------------------------

/** Die Saetze eines Eintrags als Liste; Unlesbares ergibt []. */
function parseSets(log) {
	try {
		const sets = JSON.parse(log.getString('sets') || '[]');
		return Array.isArray(sets) ? sets : [];
	} catch {
		return [];
	}
}

/**
 * Den Feed-Beitrag von `userId` fuer `date` neu berechnen. Laeuft nach jeder
 * Aenderung an Eintraegen oder Dauer des Tages. Nur Kennzahlen, keine
 * einzelnen Gewichte -- das Volumen ist eine Summe (Migration 1790168400).
 *
 * Ist der Feed fuer die Person aus, entstehen keine neuen Beitraege (alte
 * blendet die Rule aus); ein vorhandener wird aber weiter nachgezogen, damit
 * nach dem Wiedereinschalten nichts Geloeschtes auftaucht. Ist an dem Tag
 * nichts mehr trainiert, verschwindet der Beitrag samt Schulterklopfern.
 *
 * Liefert den Beitrag, wenn er gerade *entstanden* ist (das ist der Moment
 * "Training veroeffentlicht", den die Follower per Push erfahren), sonst null.
 * Den Push schickt der Aufrufer nach der Transaktion -- nicht hier drin.
 */
function rebuildPost(app, userId, date) {
	let user;
	try {
		user = app.findRecordById('users', userId);
	} catch {
		return null;
	}

	const params = { uid: userId, d: date };
	let existing = null;
	try {
		existing = app.findFirstRecordByFilter('training_posts', 'user = {:uid} && date = {:d}', params);
	} catch {
		// Noch keiner.
	}
	if (!existing && !user.getBool('training_public')) return null;

	const logs = app.findRecordsByFilter('training_logs', 'user = {:uid} && date = {:d}', '', 200, 0, params);
	const sessions = app.findRecordsByFilter('training_sessions', 'user = {:uid} && date = {:d}', '', 1, 0, params);
	const session = sessions.length > 0 ? sessions[0] : null;
	const duration = session ? session.getInt('duration') : 0;

	const counts = {};
	const records = [];
	let exercises = 0;
	let sets = 0;
	let volume = 0;
	for (let i = 0; i < logs.length; i++) {
		const log = logs[i];
		const list = parseSets(log);
		let working = 0;
		for (let j = 0; j < list.length; j++) {
			const s = list[j];
			if (s && s.warmup) continue;
			working++;
			// Wie `volumeOf` im Frontend; Zeitsaetze haben keine Wdh. und zaehlen 0.
			if (s) volume += (Number(s.weight) || 0) * (Number(s.reps) || 0);
		}
		if (working === 0) continue; // nur Notiz oder nur Aufwaermen
		exercises++;
		sets += working;

		let exercise = null;
		try {
			exercise = app.findRecordById('training_exercises', log.getString('exercise'));
		} catch {
			continue;
		}
		const w = exercise.getString('workout');
		counts[w] = (counts[w] || 0) + 1;

		// Neuer Bestwert: schwerer als alles davor -- der erste Eintrag zaehlt nicht.
		const weight = log.getFloat('weight');
		if (weight > 0) {
			const before = app.findRecordsByFilter(
				'training_logs',
				'exercise = {:e} && date < {:d} && weight > 0',
				'-weight',
				1,
				0,
				{ e: exercise.id, d: date }
			);
			if (before.length > 0 && weight > before[0].getFloat('weight')) records.push(exercise.getString('name'));
		}
	}

	if (exercises === 0 && duration === 0) {
		if (existing) app.delete(existing);
		return null;
	}

	if (session && session.getString('workout') && !(session.getString('workout') in counts)) {
		counts[session.getString('workout')] = 0;
	}
	const names = Object.keys(counts)
		.sort((a, b) => counts[b] - counts[a])
		.map((id) => {
			try {
				return app.findRecordById('training_workouts', id).getString('name');
			} catch {
				return '';
			}
		})
		.filter((n) => n);

	const post = existing || new Record(app.findCollectionByNameOrId('training_posts'));
	post.set('user', userId);
	post.set('date', date);
	post.set('workout', names.join(' + ').slice(0, 200));
	post.set('duration', Math.min(86400, duration));
	post.set('exercises', exercises);
	post.set('sets', sets);
	post.set('volume', Math.round(volume));
	post.set('records', records);
	app.save(post);
	return existing ? null : post;
}

/**
 * Push an alle, die dem Besitzer von `post` folgen (Migration 1790254800):
 * die Person hat ein Training veroeffentlicht. Nur bei einem neuen Beitrag,
 * also einmal pro Person und Tag -- die vielen Updates danach (jede Uebung
 * wird einzeln gespeichert) loesen nichts aus.
 */
function notifyFollowers(app, post) {
	const pushLib = require(`${__hooks}/push-lib.js`);
	const owner = post.getString('user');
	const follows = app.findRecordsByFilter('training_follows', 'followed = {:uid}', '', 500, 0, { uid: owner });
	if (follows.length === 0) return 0;

	let subscriptions = [];
	for (let i = 0; i < follows.length; i++) {
		const uid = follows[i].getString('follower');
		if (!uid || uid === owner) continue;
		subscriptions = subscriptions.concat(
			app.findRecordsByFilter('push_subscriptions', 'user = {:uid}', '-created', 50, 0, { uid })
		);
	}
	if (subscriptions.length === 0) return 0;

	// Nur der Name, nie der E-Mail-Fallback -- wie bei notifyKudos.
	let who = '';
	try {
		who = app.findRecordById('users', owner).getString('name').trim();
	} catch {
		// Account weg.
	}
	who = who || 'Jemand';
	const what = post.getString('workout');
	return pushLib.broadcast(app, subscriptions, {
		title: `${who} hat trainiert`,
		body: what ? `${what} – jetzt im Feed.` : 'Das Training steht jetzt im Feed.',
		// Pro Beitrag: taucht er nach dem Loeschen am selben Tag neu auf, ist das
		// eine neue Meldung.
		tag: `einkauf-follow-${post.id}`,
		url: '/training/feed'
	});
}

/** Push an den Besitzer eines Beitrags: `fromId` hat auf die Schulter geklopft. */
function notifyKudos(app, post, fromId) {
	const pushLib = require(`${__hooks}/push-lib.js`);
	const owner = post.getString('user');
	const subscriptions = app.findRecordsByFilter('push_subscriptions', 'user = {:uid}', '-created', 50, 0, {
		uid: owner
	});
	if (subscriptions.length === 0) return 0;
	// Nur der Name, nie der E-Mail-Fallback von pushLib.userLabel: der Klopfer
	// kann aus einem anderen Haushalt kommen, und im Feed steht dann auch nur
	// "Jemand".
	let who = '';
	try {
		who = app.findRecordById('users', fromId).getString('name').trim();
	} catch {
		// Account weg.
	}
	who = who || 'Jemand';
	const what = post.getString('workout');
	return pushLib.broadcast(app, subscriptions, {
		title: 'Schulterklopfer',
		body: what ? `${who} klopft dir auf die Schulter – für ${what}.` : `${who} klopft dir auf die Schulter.`,
		// Pro Beitrag und Person: eine Wiederholung ergibt keine zweite Meldung.
		tag: `einkauf-kudos-${post.id}-${fromId}`,
		url: '/training/feed'
	});
}

module.exports = { berlin, sendDueReminders, normalizeLog, rebuildPost, notifyKudos, notifyFollowers };
