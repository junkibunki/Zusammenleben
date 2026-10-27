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
 * Steht fuer `date` schon ein Satz im Verlauf (oder eine Dauer, eine Strecke)?
 * Dann braucht es keine Erinnerung mehr. Ein Eintrag nur mit Notiz zaehlt nicht
 * als Training.
 */
function trainedOn(app, userId, date) {
	const params = { uid: userId, d: date };
	const logs = app.findRecordsByFilter('training_logs', 'user = {:uid} && date = {:d}', '', 100, 0, params);
	for (let i = 0; i < logs.length; i++) {
		const raw = logs[i].getString('sets');
		if (raw && raw !== 'null' && raw !== '[]') return true;
	}
	return (
		app.findRecordsByFilter('training_sessions', 'user = {:uid} && date = {:d}', '', 1, 0, params).length > 0 ||
		app.findRecordsByFilter('training_routes', 'user = {:uid} && date = {:d}', '', 1, 0, params).length > 0
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

/** Wie KINDS in frontend/src/lib/cardio.svelte.js. */
const CARDIO_LABELS = { run: 'Laufen', bike: 'Radfahren', walk: 'Gehen' };
/** Mehr Strecken an einem Tag fasst der Beitrag nicht (maxSize 4000). */
const CARDIO_MAX = 20;

/** 5234 -> "5,2 km", 850 -> "850 m" */
function formatKm(m) {
	if (m < 1000) return `${Math.round(m)} m`;
	return `${(Math.round(m / 100) / 10).toString().replace('.', ',')} km`;
}

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
 * Eine Uebung fuer `training_posts.details` (Migration 1790600400):
 * `{ name, kind, sets: [{ weight, reps, seconds, warmup }] }`. Ohne Notiz --
 * die bleibt privat. Gleiche Form wie postDetail() in der Migration.
 */
function postDetail(exercise, list) {
	const sets = [];
	for (let i = 0; i < list.length; i++) {
		const s = list[i];
		if (!s) continue;
		const or = (v) => (typeof v === 'number' ? v : null);
		sets.push({ weight: or(s.weight), reps: or(s.reps), seconds: or(s.seconds), warmup: s.warmup === true });
	}
	return { name: exercise.getString('name'), kind: exercise.getString('kind') || 'weight', sets };
}

/**
 * Den Feed-Beitrag von `userId` fuer `date` neu berechnen. Laeuft nach jeder
 * Aenderung an Eintraegen oder Dauer des Tages. Dazu die Saetze je Uebung mit
 * Gewicht (Migration 1790600400) -- wer den Feed einschaltet, zeigt sein
 * Training komplett; nur Notizen und GPS-Punkte bleiben privat.
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
	// Nur Kennzahlen der Strecken, nie die Punkte (Migration 1790514000).
	const routes = app.findRecordsByFilter('training_routes', 'user = {:uid} && date = {:d}', 'started', CARDIO_MAX, 0, params);
	const cardio = [];
	for (let i = 0; i < routes.length; i++) {
		const r = routes[i];
		cardio.push({ kind: r.getString('kind'), distance: r.getInt('distance'), duration: r.getInt('duration') });
	}

	const counts = {};
	const records = [];
	// Saetze je Uebung fuer die Detailseite des Beitrags (Migration 1790600400).
	// Wie dort: nur Uebungen mit Arbeitssatz, ohne Notiz.
	const details = [];
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
		details.push({
			workout: w,
			sort: exercise.getInt('sort'),
			created: exercise.getString('created'),
			entry: postDetail(exercise, list)
		});

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

	if (exercises === 0 && duration === 0 && cardio.length === 0) {
		if (existing) app.delete(existing);
		return null;
	}

	if (session && session.getString('workout') && !(session.getString('workout') in counts)) {
		counts[session.getString('workout')] = 0;
	}
	const order = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
	// Uebungen in der Reihenfolge der Trainings oben, darin wie im Plan.
	details.sort(
		(a, b) =>
			order.indexOf(a.workout) - order.indexOf(b.workout) || a.sort - b.sort || a.created.localeCompare(b.created)
	);
	const names = order
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
	post.set('cardio', cardio);
	post.set('details', details.map((d) => d.entry));
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
	// Ohne Kraft-Training steht die erste Strecke da: "Laufen 5,2 km".
	let what = post.getString('workout');
	if (!what) {
		let cardio = [];
		try {
			cardio = JSON.parse(post.getString('cardio') || '[]');
		} catch {
			// Dann eben der allgemeine Text.
		}
		if (Array.isArray(cardio) && cardio.length > 0 && cardio[0]) {
			const c = cardio[0];
			what = `${CARDIO_LABELS[c.kind] || 'Cardio'} ${formatKm(Number(c.distance) || 0)}`;
		}
	}
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

// --- Satzpause (Migration 1790341200) ---------------------------------------
//
// Am Ende der Satzpause soll das Handy auch gesperrt klingeln. Gesperrt steht
// das JS der Seite still, also meldet der Server: der Client traegt das Ende
// der Pause als Zeitstempel ein (`rest_timers`, eine Zeile pro Person) und
// nimmt es zurueck, sobald er das Ende selbst erlebt (training-timer.svelte.js).
//
// Die JS-VM hat keinen setTimeout, und der Cron tickt nur zur vollen Minute.
// Darum zwei Waechter fuer dasselbe Ende: der Cron holt zu jeder vollen Minute
// alles, was bis zur naechsten faellig wird, und wartet bis dahin; was erst
// *nach* dem Tick eingetragen wird und schon vor dem naechsten faellig ist,
// wartet der Request selbst ab. Gewartet wird mit einem `sleep`-Prozess
// ($os.exec), das blockiert nur diese eine VM. Gesendet wird nur, wer die
// Zeile mit *unveraendertem* `due` loeschen konnte -- so gibt es keine
// doppelte Meldung, wenn beide dieselbe Pause bewachen, und eine verlaengerte,
// ersetzte oder abgebrochene Pause laesst den alten Waechter leer ausgehen.

/** Laenger wartet kein Waechter (Cron-Fenster ist eine Minute). */
const REST_SLEEP_MAX_MS = 90000;
/** Ein aelteres Ende (Server war weg) wird nicht mehr gemeldet, nur geloescht. */
const REST_STALE_MS = 60000;
const REST_MESSAGE = {
	title: 'Pause vorbei!',
	body: 'Weiter mit dem nächsten Satz.',
	// Ein Tag fuer alle Pausen, renotify: die naechste ersetzt die alte und
	// klingelt trotzdem. Den Tag kennt auch der Client, er schliesst die Meldung.
	tag: 'einkauf-training-rest',
	renotify: true,
	vibrate: [300, 120, 300, 120, 500],
	url: '/training'
};

/** Beginn der naechsten vollen Minute (ms). */
function nextMinute(now) {
	return Math.floor(now / 60000) * 60000 + 60000;
}

/** Push-Abos einer Person. */
function userSubscriptions(app, userId) {
	return app.findRecordsByFilter('push_subscriptions', 'user = {:uid}', '-created', 50, 0, { uid: userId });
}

/**
 * Blockiert `ms` Millisekunden ueber einen Kindprozess -- die VM kennt kein
 * setTimeout. `sleep` auf dem Server (Linux), PowerShell beim Entwickeln
 * unter Windows. false, wenn beides fehlt.
 */
function sleepMs(ms) {
	if (!(ms > 0)) return true;
	const capped = Math.min(ms, REST_SLEEP_MAX_MS);
	try {
		$os.exec('sleep', (capped / 1000).toFixed(3)).run();
		return true;
	} catch {
		// Kein sleep: Windows.
	}
	try {
		$os.exec('powershell', '-NoProfile', '-Command', 'Start-Sleep -Milliseconds ' + Math.round(capped)).run();
		return true;
	} catch {
		return false;
	}
}

/** Loescht die Zeile, aber nur, wenn `due` noch das erwartete ist. */
function claimRest(app, id, due) {
	const result = app
		.db()
		.newQuery('DELETE FROM rest_timers WHERE id = {:id} AND due = {:due}')
		.bind({ id, due })
		.execute();
	return result.rowsAffected() > 0;
}

/**
 * Wartet bis `due`, beansprucht die Zeile und schickt die Meldung an alle
 * Geraete von `userId`. true, wenn gesendet wurde.
 */
function fireRest(app, id, userId, due) {
	const wait = due - Date.now();
	if (wait < -REST_STALE_MS) {
		claimRest(app, id, due);
		return false;
	}
	if (!sleepMs(wait)) {
		app.logger().warn('Satzpause: kein sleep verfuegbar, Meldung entfaellt', 'user', userId);
		claimRest(app, id, due);
		return false;
	}
	if (!claimRest(app, id, due)) return false;
	pushLib.broadcast(app, userSubscriptions(app, userId), REST_MESSAGE);
	return true;
}

/**
 * Traegt das Ende der Pause von `userId` ein (`due` in ms). Ohne Push-Abo
 * gibt es nichts zu bewachen. Faellig vor dem naechsten Cron-Tick: dieser
 * Request wartet selbst (und antwortet erst danach).
 */
function scheduleRest(app, userId, due) {
	if (userSubscriptions(app, userId).length === 0) return { watched: false };

	let record;
	try {
		record = app.findFirstRecordByData('rest_timers', 'user', userId);
	} catch {
		record = new Record(app.findCollectionByNameOrId('rest_timers'));
		record.set('user', userId);
	}
	record.set('due', due);
	app.save(record);

	// Die Uhr erst *nach* dem Speichern lesen: faellt die volle Minute dazwischen,
	// hat der Cron die Zeile schon nicht mehr gesehen -- dann wartet dieser Request.
	if (due < nextMinute(Date.now())) fireRest(app, record.id, userId, due);
	return { watched: true };
}

/**
 * Die Seite erlebt das Ende selbst: nichts mehr melden. Mit `due` nur dieses
 * eine Ende -- ueberholt der DELETE einen spaeteren PUT, bleibt dessen Pause
 * bewacht. 0 loescht, was auch immer da steht.
 */
function cancelRest(app, userId, due) {
	app
		.db()
		.newQuery('DELETE FROM rest_timers WHERE user = {:user} AND ({:due} = 0 OR due = {:due})')
		.bind({ user: userId, due: due || 0 })
		.execute();
}

/**
 * Cron, jede Minute: alle Pausen bewachen, die bis zur naechsten vollen
 * Minute enden -- der Reihe nach, jede bis zu ihrem Ende abgewartet. `now`
 * nur fuer Tests.
 */
function fireDueRests(app, now) {
	const start = now === undefined ? Date.now() : now;
	const timers = app.findRecordsByFilter('rest_timers', 'due < {:end}', 'due', 100, 0, {
		end: nextMinute(start)
	});
	let sent = 0;
	for (let i = 0; i < timers.length; i++) {
		const t = timers[i];
		try {
			if (fireRest(app, t.id, t.getString('user'), t.getInt('due'))) sent++;
		} catch (err) {
			app.logger().warn('Satzpause-Push fehlgeschlagen', 'timer', t.id, 'fehler', String(err));
		}
	}
	return sent;
}

module.exports = {
	berlin,
	sendDueReminders,
	normalizeLog,
	rebuildPost,
	notifyKudos,
	notifyFollowers,
	scheduleRest,
	cancelRest,
	fireDueRests
};
