/// <reference path="../pb_data/types.d.ts" />

// Erinnerung an das Training. Die Logik liegt in training-lib.js und wird *in*
// jedem Callback geladen (eigene JS-VM pro Callback, siehe push.pb.js).
//
// Jede Minute statt eines Cron-Ausdrucks pro Plan: die Uhrzeiten waehlt jede
// Person selbst, und der Cron von PocketBase rechnet in UTC -- die deutsche
// Zeit bestimmt training-lib.js selbst.
cronAdd('training-reminders', '* * * * *', () => {
	try {
		require(`${__hooks}/training-lib.js`).sendDueReminders($app);
	} catch (err) {
		$app.logger().error('Trainingserinnerungen fehlgeschlagen', 'fehler', String(err));
	}
});
