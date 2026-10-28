/// <reference path="../pb_data/types.d.ts" />

// Gaeste einladen (Seite "Bewohner"): ein Haupt-Mitglied sucht unter *allen*
// Accounts und traegt eine Person als Gast ein, auf Wunsch mit Enddatum.
// Spaeter kann es das Enddatum eines laufenden Gastes aendern oder ihn
// austragen; Haupt-Mitgliedschaften fasst keine dieser Routen an.
//
// Eigene Routen statt offener Rules: die ListRule von `users` zeigt nur
// Mitbewohner (und wer Training eingeschaltet hat). Sie fuer die Suche zu
// oeffnen, gaebe jedem Haupt-Mitglied alle Felder aller Accounts preis. Hier
// kommt nur heraus, was die Trefferliste braucht: Name und Profilfoto.
//
// Die Routen stehen in households.pb.js und holen sich diese Datei per
// require -- PocketBase fuehrt jeden Handler in einer eigenen JS-VM aus, die
// den Modulscope der .pb.js nicht kennt.

/** Laufend: leeres oder kuenftiges `until`, wie in den API-Rules (1789304400). */
function isActive(membership) {
	const until = membership.getString('until');
	if (!until) return true;
	const end = new Date(until.replace(' ', 'T')).getTime();
	return Number.isNaN(end) || end > Date.now();
}

/** Wirft 403, wenn `authId` nicht laufendes Haupt-Mitglied des Haushalts ist. */
function requireMain(app, authId, householdId) {
	let membership = null;
	try {
		membership = app.findFirstRecordByFilter(
			'memberships',
			'user = {:u} && household = {:h} && role = "haupt"',
			{ u: authId, h: householdId }
		);
	} catch {
		// Keine Zeile -- unten abweisen.
	}
	if (!membership || !isActive(membership)) {
		throw new ForbiddenError('Nur Haupt-Mitglieder können Gäste verwalten.');
	}
}

/** Feldfehler, den das SDK unter `err.response.data.<field>` liefert. */
function fail(field, code, message) {
	throw new BadRequestError(message, { [field]: new ValidationError(code, message) });
}

/** ISO-Zeitpunkt aus dem Request -> gespeichertes `until`; leer bleibt leer (unbefristet). */
function parseUntil(until) {
	if (!until) return '';
	const t = new Date(until).getTime();
	if (Number.isNaN(t)) fail('until', 'guest_until_invalid', 'Das Enddatum ist ungültig.');
	if (t <= Date.now()) fail('until', 'guest_until_past', 'Das Enddatum muss in der Zukunft liegen.');
	return new Date(t).toISOString();
}

/** Die laufende Gastmitgliedschaft von `userId` im Haushalt; sonst 404. */
function findActiveGuest(app, householdId, userId) {
	let membership = null;
	try {
		membership = app.findFirstRecordByFilter(
			'memberships',
			'user = {:u} && household = {:h} && role = "gast"',
			{ u: userId, h: householdId }
		);
	} catch {
		// Keine Zeile -- unten abweisen.
	}
	if (!membership || !isActive(membership)) {
		throw new NotFoundError('Die Person ist hier nicht (mehr) zu Gast.');
	}
	return membership;
}

/** Was die Seite von einem Account zu sehen bekommt -- genug fuer `avatarUrl()`. */
function publicUser(user) {
	return {
		id: user.id,
		collectionId: user.collection().id,
		collectionName: user.collection().name,
		name: user.getString('name'),
		avatar: user.getString('avatar'),
		created: user.getString('created')
	};
}

/**
 * Accounts, deren Name `query` enthaelt oder deren E-Mail genau `query` ist --
 * ohne die, die schon laufend im Haushalt sind (also auch ohne mich). Die
 * E-Mail nur exakt: sonst liesse sie sich Buchstabe fuer Buchstabe erraten,
 * und Accounts ohne Namen waeren gar nicht zu finden.
 */
function searchGuests(app, authId, householdId, query) {
	requireMain(app, authId, householdId);
	const q = String(query || '').trim();
	if (!q) return [];

	const taken = {};
	const rows = app.findRecordsByFilter('memberships', 'household = {:h}', '', 0, 0, {
		h: householdId
	});
	for (let i = 0; i < rows.length; i++) {
		if (isActive(rows[i])) taken[rows[i].getString('user')] = true;
	}

	const found = app.findRecordsByFilter('users', 'name ~ {:q} || email:lower = {:mail}', 'name', 50, 0, {
		q: q,
		mail: q.toLowerCase()
	});
	const out = [];
	for (let i = 0; i < found.length && out.length < 20; i++) {
		if (!taken[found[i].id]) out.push(publicUser(found[i]));
	}
	return out;
}

/**
 * Traegt `userId` als Gast ein. `until` ist ein ISO-Zeitpunkt oder leer
 * (unbefristet). War die Person schon einmal Gast und ist abgelaufen, lebt die
 * alte Zeile wieder auf -- eine zweite verbietet `idx_memberships_pair`.
 */
function inviteGuest(app, authId, householdId, userId, until) {
	requireMain(app, authId, householdId);

	let user = null;
	try {
		user = app.findRecordById('users', userId);
	} catch {
		fail('user', 'guest_unknown_user', 'Diesen Account gibt es nicht.');
	}

	const end = parseUntil(until);

	let membership = null;
	try {
		membership = app.findFirstRecordByFilter('memberships', 'user = {:u} && household = {:h}', {
			u: userId,
			h: householdId
		});
	} catch {
		// Noch nie hier gewesen -- unten anlegen.
	}
	if (membership && isActive(membership)) {
		fail(
			'user',
			'guest_already_member',
			membership.getString('role') === 'haupt' ? 'Die Person wohnt hier schon.' : 'Die Person ist schon zu Gast.'
		);
	}
	if (!membership) {
		membership = new Record(app.findCollectionByNameOrId('memberships'));
		membership.set('user', userId);
		membership.set('household', householdId);
	}
	// Auch eine abgelaufene Haupt-Mitgliedschaft (nur per Admin-UI moeglich)
	// kommt als Gast zurueck: ein Enddatum an "haupt" weist households.pb.js ab.
	membership.set('role', 'gast');
	membership.set('until', end);
	try {
		app.save(membership);
	} catch (err) {
		// Zwei Einladungen gleichzeitig: die zweite scheitert am Unique-Index.
		app.logger().warn('Gast eintragen fehlgeschlagen', 'haushalt', householdId, 'fehler', String(err));
		fail('user', 'guest_save_failed', 'Die Einladung hat nicht geklappt.');
	}

	try {
		require(`${__hooks}/push-lib.js`).notifyGuestInvited(app, membership, authId);
	} catch (err) {
		// Der Gast steht schon in der Datenbank -- ein Push-Problem darf die
		// Antwort nicht zu einem Fehler machen.
		app.logger().error('Push zur Einladung fehlgeschlagen', 'fehler', String(err));
	}

	return {
		user: publicUser(user),
		membership: { role: 'gast', until: membership.getString('until'), active: true }
	};
}

/** Neues Enddatum fuer einen laufenden Gast; leer heisst unbefristet. */
function updateGuest(app, authId, householdId, userId, until) {
	requireMain(app, authId, householdId);
	const membership = findActiveGuest(app, householdId, userId);
	membership.set('until', parseUntil(until));
	app.save(membership);
	return { role: 'gast', until: membership.getString('until'), active: true };
}

/**
 * Gast austragen. Die Zeile bleibt stehen und laeuft nur ab -- wie jede
 * abgelaufene Mitgliedschaft haelt sie den Namen in alten Ausgaben lesbar
 * (Migration 1789304400). Wieder einladen belebt sie neu.
 */
function removeGuest(app, authId, householdId, userId) {
	requireMain(app, authId, householdId);
	const membership = findActiveGuest(app, householdId, userId);
	membership.set('until', new Date().toISOString());
	app.save(membership);
}

module.exports = { searchGuests, inviteGuest, updateGuest, removeGuest };
