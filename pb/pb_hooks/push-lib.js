/// <reference path="../pb_data/types.d.ts" />

// Serverseite von Web Push: Schluessel verwalten, Empfaenger suchen, senden.
//
// Warum das nicht in push.pb.js steht: PocketBase fuehrt jeden Hook-Callback in
// einer eigenen JS-VM aus, die den Modulscope der Hook-Datei nicht kennt. Eine
// Funktion neben dem Hook zu definieren und darin aufzurufen endet in
// `ReferenceError: <name> is not defined`. Alles Gemeinsame muss also in ein
// Modul, das *innerhalb* des Callbacks geladen wird.
//
// Die Krypto steckt in webpush.js (generiert, siehe frontend/scripts/).

const webpush = require(`${__hooks}/webpush.js`);

const CONFIG_ID = 'vapid';

// Der Versand laeuft synchron im Request des Anlegenden mit -- die JS-VM hat
// kein setTimeout und keine Goroutine. Deshalb zwei Grenzen: eine pro Dienst
// und eine fuer alles zusammen, damit ein paar unerreichbare Geraete nicht den
// "Hinzufuegen"-Knopf minutenlang drehen lassen.
const SEND_TIMEOUT = 3; // Sekunden pro Push-Dienst
const TOTAL_BUDGET = 9000; // Millisekunden fuer alle Empfaenger zusammen

/**
 * Kontaktadresse fuer den Push-Dienst (RFC 8292 verlangt https: oder mailto:).
 * Bewusst bei jedem Versand neu bestimmt und *nicht* gespeichert: sonst friert
 * der Wert von dem Rechner ein, auf dem die Schluessel entstanden sind -- eine
 * Dev-Instanz wuerde `mailto:admin@localhost` fuer immer mitschleppen, und
 * Apple ist beim `sub` streng.
 */
function subject(app) {
	const url = app.settings().meta.appURL || '';
	if (url.indexOf('https://') === 0) return url;

	try {
		const admins = app.findAllRecords('_superusers');
		if (admins.length > 0) return `mailto:${admins[0].getString('email')}`;
	} catch {
		// Ohne Superuser laeuft PocketBase nicht -- reiner Sicherheitsgurt.
	}
	return 'mailto:admin@localhost';
}

/**
 * Die VAPID-Schluessel des Servers; legt sie beim ersten Aufruf an.
 * Sie muessen stabil bleiben: die Abos der Browser sind an den oeffentlichen
 * Schluessel gebunden und werden mit einem neuen Paar alle ungueltig.
 */
function vapid(app) {
	try {
		return app.findRecordById('push_config', CONFIG_ID);
	} catch {
		// Noch keine Schluessel -- unten anlegen.
	}

	const keys = webpush.generateVapidKeys();
	const record = new Record(app.findCollectionByNameOrId('push_config'));
	record.set('id', CONFIG_ID);
	record.set('public_key', keys.publicKey);
	record.set('private_key', keys.privateKey);
	app.save(record);

	app.logger().info('VAPID-Schluesselpaar fuer Web Push erzeugt');
	return record;
}

/** Der oeffentliche Schluessel, den pushManager.subscribe() im Browser braucht. */
function publicKey(app) {
	return vapid(app).getString('public_key');
}

/**
 * Schickt eine Nachricht an ein Abo. Liefert true, wenn der Dienst sie
 * angenommen hat.
 *
 * Ein Abo, das der Dienst nicht mehr kennt (404/410) oder nicht mehr zu unserem
 * Schluessel passt (403), wird geloescht: der Datensatz ist unbrauchbar, und
 * beim naechsten Oeffnen der App legt der Browser ein frisches an. So raeumt
 * sich die Tabelle selbst auf.
 */
function sendTo(app, subscription, message, config, from) {
	const endpoint = subscription.getString('endpoint');

	const request = webpush.buildRequest({
		endpoint,
		p256dh: subscription.getString('p256dh'),
		auth: subscription.getString('auth'),
		payload: JSON.stringify(message),
		publicKey: config.getString('public_key'),
		privateKey: config.getString('private_key'),
		subject: from
	});

	const res = $http.send({
		url: request.url,
		method: request.method,
		// Bewusst das Uint8Array: als String wuerde die JS-VM die Bytes als
		// UTF-8 kodieren und der Push-Dienst bekaeme Datenmuell.
		body: request.body,
		headers: request.headers,
		timeout: SEND_TIMEOUT
	});

	if (res.statusCode === 403 || res.statusCode === 404 || res.statusCode === 410) {
		app.delete(subscription);
		app.logger().info(
			'Unbrauchbares Push-Abo entfernt',
			'status',
			res.statusCode,
			'endpoint',
			endpoint
		);
		return false;
	}

	if (res.statusCode < 200 || res.statusCode > 299) {
		app.logger().warn(
			'Push abgelehnt',
			'status',
			res.statusCode,
			'endpoint',
			endpoint,
			// toString(), nicht String(): res.body ist ein Byte-Array und wuerde
			// sonst als "112,101,114,..." im Log stehen -- unlesbar genau dort, wo
			// der Dienst den Grund nennt.
			'antwort',
			toString(res.body, 200)
		);
		return false;
	}

	return true;
}

/**
 * Verschickt `message` an alle uebergebenen Abos und liefert die Zahl der
 * angenommenen. Fehler bei einem Empfaenger duerfen die anderen nicht
 * aufhalten und schon gar nicht den Request sprengen, in dem das mitlaeuft.
 */
function broadcast(app, subscriptions, message) {
	if (subscriptions.length === 0) return 0;

	const config = vapid(app);
	const from = subject(app);
	const started = Date.now();
	let sent = 0;

	for (let i = 0; i < subscriptions.length; i++) {
		if (Date.now() - started > TOTAL_BUDGET) {
			app.logger().warn(
				'Push-Versand abgebrochen, Zeitbudget erschoepft',
				'verschickt',
				sent,
				'uebersprungen',
				subscriptions.length - i
			);
			break;
		}

		try {
			if (sendTo(app, subscriptions[i], message, config, from)) sent++;
		} catch (err) {
			app.logger().warn(
				'Push fehlgeschlagen',
				'endpoint',
				subscriptions[i].getString('endpoint'),
				'fehler',
				String(err)
			);
		}
	}
	return sent;
}

/** Anzeigename eines Users -- dieselbe Logik wie im Frontend. */
function userLabel(app, id) {
	if (!id) return '';
	try {
		const user = app.findRecordById('users', id);
		return user.getString('name') || user.getString('email').split('@')[0] || 'Jemand';
	} catch {
		return ''; // z.B. geloeschter Account
	}
}

/**
 * Die Abos aller laufenden Mitglieder eines Haushalts, ausser `exceptId`.
 *
 * Laufend heisst: Haupt oder Gast mit leerem bzw. noch nicht erreichtem
 * `until` -- dieselbe Bedingung wie in den API-Rules (Migration 1789304400).
 * Wer die Zeile nicht sehen darf, soll auch nicht per Push davon erfahren.
 */
function householdSubscriptions(app, householdId, exceptId) {
	if (!householdId) return [];

	const memberships = app.findRecordsByFilter(
		'memberships',
		'household = {:h} && (until = "" || until > @now)',
		'',
		500,
		0,
		{ h: householdId }
	);

	let out = [];
	for (let i = 0; i < memberships.length; i++) {
		const uid = memberships[i].getString('user');
		if (!uid || uid === exceptId) continue;
		out = out.concat(
			app.findRecordsByFilter('push_subscriptions', 'user = {:uid}', '-created', 50, 0, { uid })
		);
	}
	return out;
}

/** Name des Haushalts fuer den Meldungstext; leer, wenn er nicht zu finden ist. */
function householdLabel(app, id) {
	if (!id) return '';
	try {
		return app.findRecordById('households', id).getString('name');
	} catch {
		return '';
	}
}

/** Name einer Kategorie (Migration 1789477200); leer, wenn keine oder geloescht. */
function categoryLabel(app, id) {
	if (!id) return '';
	try {
		return app.findRecordById('categories', id).getString('name');
	} catch {
		return '';
	}
}

/** Probebenachrichtigung an alle Geraete *einer* Person. */
function sendTest(app, userId) {
	const subscriptions = app.findRecordsByFilter(
		'push_subscriptions',
		'user = {:uid}',
		'-created',
		50,
		0,
		{ uid: userId }
	);

	const sent = broadcast(app, subscriptions, {
		title: 'Probebenachrichtigung',
		body: 'Wenn du das siehst, funktionieren die Benachrichtigungen.',
		tag: 'einkauf-test',
		url: '/'
	});

	return { subscriptions: subscriptions.length, sent };
}

/**
 * Ein neuer Eintrag auf dem Zettel -- alle im Haushalt ausser dem Verfasser
 * bekommen ihn.
 *
 * `actorId` ist der *angemeldete* Nutzer aus dem Request, nicht das Feld
 * `added_by`: dem Feld kann ein Client jede beliebige ID mitgeben, und dann
 * bekaeme der Anlegende die eigene Meldung und ein anderer keine.
 */
function notifyNewItem(app, record, actorId) {
	const author = actorId || record.getString('added_by');

	// Wer den Eintrag geschrieben hat, weiss es schon; die anderen nur, wenn
	// sie im Haushalt des Eintrags sind.
	const household = record.getString('household');
	const subscriptions = householdSubscriptions(app, household, author);

	const name = record.getString('name');
	const quantity = record.getString('quantity');
	// Fuer den *Text* zaehlt, was in der Liste steht -- also `added_by`.
	const from = userLabel(app, record.getString('added_by'));

	const details = [];
	const category = categoryLabel(app, record.getString('category'));
	if (category) details.push(category);
	if (from) details.push(`von ${from}`);
	// Wer Gast in einem zweiten Haushalt ist, muss sehen, auf welchem Zettel
	// das steht.
	const where = householdLabel(app, household);
	if (where) details.push(where);

	return broadcast(app, subscriptions, {
		title: `Neu: ${quantity ? `${name} · ${quantity}` : name}`,
		body: details.join(' · '),
		// Ein Tag pro Eintrag: zwei neue Sachen ergeben zwei Meldungen, derselbe
		// Eintrag (Wiederholung durch den Push-Dienst) nur eine.
		tag: `einkauf-item-${record.id}`,
		url: '/'
	});
}

/**
 * Cent -> "1.234,56 €". Von Hand, weil `Intl` in der JS-VM von PocketBase nicht
 * verlaesslich vorhanden ist -- `toLocaleString('de-DE', …)` liefert dort im
 * Zweifel die englische Form, und "1,234.56" in einer deutschen Meldung liest
 * sich wie ein anderer Betrag.
 *
 * Das Vorzeichen faellt bewusst weg: der Text davor sagt schon, in welche
 * Richtung das Geld geflossen ist, und ein Minus dahinter waere doppelt.
 */
function euro(cents) {
	const abs = Math.abs(Math.round(Number(cents) || 0));
	const whole = String(Math.floor(abs / 100));
	const rest = String(abs % 100);

	let grouped = '';
	for (let i = 0; i < whole.length; i++) {
		if (i > 0 && (whole.length - i) % 3 === 0) grouped += '.';
		grouped += whole.charAt(i);
	}
	return `${grouped},${rest.length < 2 ? `0${rest}` : rest} €`;
}

/**
 * Eine neue Ausgabe oder Erstattung -- alle ausser dem Eintragenden bekommen
 * sie, soweit sie im Haushalt der Ausgabe sind. Bewusst *alle* und nicht nur
 * die Beteiligten: wer nicht mitzahlt, sieht
 * die Zeile trotzdem in der Liste, und eine Benachrichtigung, die mal kommt und
 * mal nicht, ist schwerer zu deuten als eine, die immer kommt.
 *
 * `actorId` ist der angemeldete Nutzer aus dem Request, nicht `created_by`:
 * dem Feld kann ein Client jede ID mitgeben, und dann bekaeme der Anlegende die
 * eigene Meldung und ein anderer keine. Dieselbe Trennung wie in
 * `notifyNewItem`.
 *
 * Ein negativer Betrag ist eine Erstattung: `paid_by` hat das Geld dann nicht
 * ausgelegt, sondern bekommen.
 */
function notifyNewExpense(app, record, actorId) {
	const author = actorId || record.getString('created_by');

	const household = record.getString('household');
	const subscriptions = householdSubscriptions(app, household, author);

	const cents = record.getInt('amount_cents');
	const refund = cents < 0;
	const who = userLabel(app, record.getString('paid_by'));
	const members = record.get('shared_with') || [];
	const count = members.length || 0;

	const details = [record.getString('title')];
	if (who) details.push(`${refund ? 'erhalten von' : 'bezahlt von'} ${who}`);
	if (count > 0) details.push(count === 1 ? 'auf 1 Person' : `auf ${count} Personen`);
	const where = householdLabel(app, household);
	if (where) details.push(where);

	return broadcast(app, subscriptions, {
		title: `${refund ? 'Erstattung' : 'Neue Ausgabe'}: ${euro(cents)}`,
		body: details.join(' · '),
		// Ein Tag pro Eintrag: zwei Ausgaben ergeben zwei Meldungen, derselbe
		// Eintrag (Wiederholung durch den Push-Dienst) nur eine.
		tag: `einkauf-expense-${record.id}`,
		url: '/ausgaben'
	});
}

module.exports = { vapid, publicKey, broadcast, sendTest, notifyNewItem, notifyNewExpense };
