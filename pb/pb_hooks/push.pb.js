/// <reference path="../pb_data/types.d.ts" />

// Web Push: neue Eintraege auf dem Zettel als Benachrichtigung an alle anderen.
//
// Hier stehen nur die Anmeldungen der Hooks. Die Logik liegt in push-lib.js und
// wird *in* jedem Callback geladen: PocketBase fuehrt Callbacks in einer eigenen
// JS-VM aus, die den Modulscope dieser Datei nicht kennt.
//
// Das Senden laeuft bewusst synchron im Request des Anlegenden mit -- die JS-VM
// hat kein setTimeout und keine Goroutine. Bei einer Familienliste sind das
// wenige HTTP-Requests mit knappem Timeout.

// Schluessel gleich beim Start anlegen, damit der erste Klick auf "Einschalten"
// nicht darauf warten muss. Darf den Start nicht mitnehmen: die Migrationen
// laufen erst in e.next(), und ein Fehler hier wuerde die ganze App stoppen.
onBootstrap((e) => {
	e.next();
	try {
		require(`${__hooks}/push-lib.js`).vapid(e.app);
	} catch (err) {
		e.app.logger().error('VAPID-Schluessel nicht verfuegbar', 'fehler', String(err));
	}
});

// Der Browser braucht den oeffentlichen Schluessel fuer pushManager.subscribe().
routerAdd(
	'GET',
	'/api/push/key',
	(e) => {
		return e.json(200, { publicKey: require(`${__hooks}/push-lib.js`).publicKey(e.app) });
	},
	$apis.requireAuth()
);

// Probebenachrichtigung an die eigenen Geraete -- ohne das laesst sich nicht
// pruefen, ob die Kette Browser -> Push-Dienst -> Geraet steht.
routerAdd(
	'POST',
	'/api/push/test',
	(e) => {
		return e.json(200, require(`${__hooks}/push-lib.js`).sendTest(e.app, e.auth.id));
	},
	$apis.requireAuth()
);

// Der eigentliche Ausloeser: ein neuer Eintrag auf dem Zettel.
//
// Bewusst der Request-Hook und nicht onRecordAfterCreateSuccess: nur hier steht
// in `e.auth`, *wer* den Eintrag angelegt hat. Das Feld `added_by` kommt aus dem
// Request und ist damit frei waehlbar -- danach zu filtern hiesse, den Ausschluss
// dem Client zu ueberlassen. Nach e.next() ist der Eintrag gespeichert.
onRecordCreateRequest((e) => {
	e.next();
	try {
		require(`${__hooks}/push-lib.js`).notifyNewItem(e.app, e.record, e.auth?.id);
	} catch (err) {
		// Der Eintrag steht schon in der Datenbank -- ein Push-Problem darf die
		// Antwort an den Client nicht zu einem Fehler machen.
		e.app.logger().error('Push zu neuem Eintrag fehlgeschlagen', 'fehler', String(err));
	}
}, 'items');
