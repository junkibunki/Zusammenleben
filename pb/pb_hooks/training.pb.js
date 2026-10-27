/// <reference path="../pb_data/types.d.ts" />

// Training: Pruefung der Saetze und Erinnerung. Die Logik liegt in
// training-lib.js und wird *in* jedem Callback geladen (eigene JS-VM pro
// Callback, siehe push.pb.js).

// Saetze eines Eintrags pruefen und `weight` daraus ableiten (Migration
// 1789822800). Ein Request ohne `sets` (alter Client) laesst beides stehen.
const checkLog = (e) => {
	const body = e.requestInfo().body || {};
	if (body.sets !== undefined) {
		const message = require(`${__hooks}/training-lib.js`).normalizeLog(e.record);
		if (message) {
			throw new BadRequestError(message, { sets: new ValidationError('training_sets_invalid', message) });
		}
	}
	e.next();
};
onRecordCreateRequest(checkLog, 'training_logs');
onRecordUpdateRequest(checkLog, 'training_logs');

// Feed (Migration 1789909200): nach jeder Aenderung an Eintraegen oder Dauer
// den Beitrag des Tages neu berechnen. Ein Fehler hier darf das Speichern des
// Trainings nicht scheitern lassen -- der Feed ist Beiwerk.
// In einer Transaktion: saveDay() speichert alle Uebungen eines Tages parallel,
// und ohne Serialisierung legten zwei Requests denselben Beitrag an (einer
// scheitert am Unique-Index) oder der mit dem aelteren Stand schriebe zuletzt.
//
// Entsteht dabei ein neuer Beitrag, erfahren das die Follower per Push
// (Migration 1790254800) -- erst *nach* der Transaktion: der Versand dauert
// bis zu neun Sekunden, und solange soll die Datenbank nicht gesperrt sein.
// Das Ergebnis ueber eine Variable herausreichen: der Transaktions-Callback
// ist in Go ein `func(txApp) error`, sein Rueckgabewert ist kein Datenkanal.
const syncPost = (e) => {
	let fresh = null;
	try {
		const lib = require(`${__hooks}/training-lib.js`);
		const user = e.record.getString('user');
		const date = e.record.getString('date');
		e.app.runInTransaction((txApp) => {
			fresh = lib.rebuildPost(txApp, user, date);
		});
	} catch (err) {
		e.app.logger().warn('Feed-Beitrag nicht aktualisiert', 'record', e.record.id, 'fehler', String(err));
	}
	if (fresh) {
		try {
			require(`${__hooks}/training-lib.js`).notifyFollowers(e.app, fresh);
		} catch (err) {
			e.app.logger().warn('Follower-Push fehlgeschlagen', 'post', fresh.id, 'fehler', String(err));
		}
	}
	e.next();
};
onRecordAfterCreateSuccess(syncPost, 'training_logs', 'training_sessions');
onRecordAfterUpdateSuccess(syncPost, 'training_logs', 'training_sessions');
onRecordAfterDeleteSuccess(syncPost, 'training_logs', 'training_sessions');

// Schulterklopfer: nur `kudos` aendern, nur sich selbst, nie beim eigenen
// Beitrag (das schliesst schon die UpdateRule aus). Wie die Likes der Ideen,
// siehe ideas.pb.js. Danach eine Push-Meldung an den Besitzer.
onRecordUpdateRequest((e) => {
	if (e.hasSuperuserAuth()) return e.next();
	const me = e.auth ? e.auth.id : '';
	const fail = (message) => {
		throw new BadRequestError(message, { kudos: new ValidationError('kudos_invalid', message) });
	};

	const body = e.requestInfo().body || {};
	for (const key in body) {
		if (key !== 'kudos' && key !== 'kudos+' && key !== 'kudos-') fail('Am Beitrag lässt sich nur der Schulterklopfer ändern.');
	}

	const before = e.record.original().getStringSlice('kudos');
	const after = e.record.getStringSlice('kudos');
	const added = [];
	const removed = [];
	for (let i = 0; i < after.length; i++) if (before.indexOf(after[i]) === -1) added.push(after[i]);
	for (let i = 0; i < before.length; i++) if (after.indexOf(before[i]) === -1) removed.push(before[i]);
	for (const id of added.concat(removed)) {
		if (id !== me) fail('Du kannst nur deinen eigenen Schulterklopfer setzen oder entfernen.');
	}
	if (e.record.getString('user') === me) fail('Dir selbst kannst du nicht auf die Schulter klopfen.');

	e.next();

	if (added.length > 0) {
		try {
			require(`${__hooks}/training-lib.js`).notifyKudos(e.app, e.record, me);
		} catch (err) {
			e.app.logger().warn('Schulterklopfer-Push fehlgeschlagen', 'post', e.record.id, 'fehler', String(err));
		}
	}
}, 'training_posts');

// Erinnerung: jede Minute statt eines Cron-Ausdrucks pro Plan -- die Uhrzeiten
// waehlt jede Person selbst, und der Cron von PocketBase rechnet in UTC; die
// deutsche Zeit bestimmt training-lib.js selbst.
cronAdd('training-reminders', '* * * * *', () => {
	try {
		require(`${__hooks}/training-lib.js`).sendDueReminders($app);
	} catch (err) {
		$app.logger().error('Trainingserinnerungen fehlgeschlagen', 'fehler', String(err));
	}
});

// Satzpause (Migration 1790341200): das Ende der Pause eintragen, damit der
// Server am Ende eine Push-Meldung schickt, wenn das Handy gesperrt ist --
// und zuruecknehmen, sobald die Seite das Ende selbst erlebt. Liegt das Ende
// noch vor dem naechsten Cron-Tick, wartet der PUT-Request selbst darauf und
// antwortet erst dann (training-lib.js erklaert, warum).
routerAdd(
	'PUT',
	'/api/training/rest',
	(e) => {
		const body = e.requestInfo().body || {};
		const due = Number(body.due);
		const now = Date.now();
		if (!Number.isFinite(due) || due < now - 60000 || due > now + 30 * 60000) {
			throw new BadRequestError('Ungültiges Ende der Pause.');
		}
		return e.json(200, require(`${__hooks}/training-lib.js`).scheduleRest(e.app, e.auth.id, Math.round(due)));
	},
	$apis.requireAuth()
);

routerAdd(
	'DELETE',
	'/api/training/rest',
	(e) => {
		const due = Number((e.requestInfo().query || {}).due);
		require(`${__hooks}/training-lib.js`).cancelRest(e.app, e.auth.id, Number.isFinite(due) ? Math.round(due) : 0);
		return e.json(200, {});
	},
	$apis.requireAuth()
);

// Jede volle Minute: die Pausen bewachen, die bis zur naechsten enden. Der
// Lauf kann bis zu einer Minute dauern; PocketBase startet jeden Cron-Lauf in
// einer eigenen Goroutine, die Erinnerungen oben warten nicht darauf.
cronAdd('training-rest', '* * * * *', () => {
	try {
		require(`${__hooks}/training-lib.js`).fireDueRests($app);
	} catch (err) {
		$app.logger().error('Satzpausen-Cron fehlgeschlagen', 'fehler', String(err));
	}
});
