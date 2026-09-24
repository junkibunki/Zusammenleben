/// <reference path="../pb_data/types.d.ts" />

// Haushalte und Mitgliedschaften (Migration 1789304400). Gepflegt werden beide
// im Admin-UI; was die Datenbank selbst sichert (hoechstens ein Haupthaushalt,
// keine Person zweimal im selben Haushalt), steht dort als Unique-Index.

// Jeder Haushalt hat genau einen Gundula-Record, mit der ID des Haushalts.
// Die CreateRule von `car_location` ist `null`, der Client kann ihn also nicht
// selbst anlegen -- das passiert hier, fuer jeden neuen Haushalt, egal ob per
// Admin-UI oder API. Die Bestandshaushalte versorgt die Migration.
onRecordAfterCreateSuccess((e) => {
	e.next();
	try {
		// Den Bestandshaushalt der Migration hat die Migration selbst versorgt.
		try {
			e.app.findRecordById('car_location', e.record.id);
			return;
		} catch {
			// Noch keiner -- unten anlegen.
		}
		const car = new Record(e.app.findCollectionByNameOrId('car_location'));
		car.set('id', e.record.id);
		car.set('household', e.record.id);
		e.app.save(car);
	} catch (err) {
		// Der Haushalt steht schon. Ohne Record zeigt die Seite "Wo ist Gundula"
		// eine Fehlermeldung; nachtragen laesst er sich im Admin-UI (ID = Haushalt).
		e.app
			.logger()
			.error('Gundula-Record fuer neuen Haushalt fehlt', 'haushalt', e.record.id, 'fehler', String(err));
	}
}, 'households');

// Jeder neue Haushalt startet mit denselben Kategorien wie die Bestandshaushalte
// (Migration 1789477200); danach pflegen die Haupt-Mitglieder sie auf der Seite
// "Haushalt-Einstellungen".
onRecordAfterCreateSuccess((e) => {
	e.next();
	try {
		// Laeuft der Hook waehrend einer Migration, gibt es `categories` evtl.
		// noch nicht -- dann versorgt die Migration 1789477200 den Haushalt.
		const collection = e.app.findCollectionByNameOrId('categories');
		const existing = e.app.findRecordsByFilter('categories', 'household = {:h}', '', 1, 0, {
			h: e.record.id
		});
		if (existing.length > 0) return;
		['Supermarkt', 'Drogerie', 'Baumarkt', 'IKEA'].forEach((name, i) => {
			const c = new Record(collection);
			c.set('household', e.record.id);
			c.set('name', name);
			c.set('sort', i);
			e.app.save(c);
		});
	} catch (err) {
		// Der Haushalt steht schon; ohne Kategorien landet alles unter "Ohne
		// Kategorie", und anlegen kann sie jedes Haupt-Mitglied selbst.
		e.app
			.logger()
			.warn('Standard-Kategorien fuer neuen Haushalt fehlen', 'haushalt', e.record.id, 'fehler', String(err));
	}
}, 'households');

// Ein Enddatum hat nur ein Gast. Laeuft eine Haupt-Mitgliedschaft ab, steht die
// Person ohne Zuhause da, und das faellt erst auf, wenn sie sich beschwert.
// Request-Hooks statt onRecordValidate: nur so kommt der Text als Feldfehler
// im Admin-UI an (docs/pitfalls/pocketbase-hooks.md).
const checkMembership = (e) => {
	if (e.record.getString('role') === 'haupt' && e.record.getString('until')) {
		const message = 'Nur eine Gastmitgliedschaft kann ablaufen.';
		throw new BadRequestError(message, {
			until: new ValidationError('membership_main_until', message)
		});
	}
	e.next();
};
onRecordCreateRequest(checkMembership, 'memberships');
onRecordUpdateRequest(checkMembership, 'memberships');
