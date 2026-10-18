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
