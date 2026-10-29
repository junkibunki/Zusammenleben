/// <reference path="../pb_data/types.d.ts" />

// Geschenkewuensche: Doppelte abfangen.
//
// Das muss hier passieren, nicht im Client. Der Anlegende sieht seine eigenen
// Wuensche nach dem Speichern nicht mehr (API-Rules in der Migration
// 1789045200) -- er kann also weder pruefen, ob er etwas schon gewuenscht hat,
// noch waere ihm zu glauben, wenn er es behauptet.
//
// Wer der Wuenschende und wer der Autor ist, entscheidet dagegen die CreateRule
// (Migration 1790773200) und *nicht* dieser Hook: die Rule laeuft vor
// dem Hook, ein `e.record.set('wisher', …)` hier kaeme also zu spaet
// (docs/pitfalls/pocketbase-hooks.md).
//
// Alles steht in *einem* Callback: PocketBase fuehrt Callbacks in einer eigenen
// JS-VM aus, die den Modulscope dieser Datei nicht kennt -- eine Hilfsfunktion
// neben `onRecordCreateRequest` waere dort nicht definiert.
onRecordCreateRequest((e) => {
	// Vergleichbare Form eines Wunsches: klein, Umlaute ausgeschrieben, alles
	// weg, was kein Buchstabe und keine Ziffer ist. "Kaffee-Muehle",
	// "kaffee muehle " und "Kaffeemuehle" landen damit auf demselben Wert.
	const normalize = (value) =>
		String(value == null ? '' : value)
			.toLowerCase()
			.replace(/ä/g, 'ae')
			.replace(/ö/g, 'oe')
			.replace(/ü/g, 'ue')
			.replace(/ß/g, 'ss')
			.replace(/[^a-z0-9]+/g, '');

	const text = e.record.getString('text').trim();
	// Bleibt nach dem Normalisieren nichts uebrig (ein Wunsch aus reiner
	// Zeichensetzung), waere der leere String der Schluessel -- und der zweite
	// solche Wunsch faelschlich ein Doppelter. Dann lieber der rohe Text.
	const norm = normalize(text) || text.toLowerCase();

	e.record.set('text', text);
	e.record.set('text_norm', norm);
	// Die Beschreibung geht ungeprueft durch -- sie zaehlt beim Vergleich nicht
	// mit (Migration 1789131600), nur Leerraum an den Enden muss weg.
	e.record.set('note', e.record.getString('note').trim());

	// `wisher` ist, fuer wen der Wunsch ist; `author`, wer ihn notiert hat
	// (Migration 1790773200). Beides prueft die CreateRule. Nur das Admin-UI
	// darf `author` leer lassen -- dann war es ein eigener Wunsch.
	const wisher = e.record.getString('wisher');
	let author = e.record.getString('author');
	if (!author) {
		author = wisher;
		e.record.set('author', wisher);
	}
	const own = author === wisher;

	// Doppelt ist ein Wunsch nur im selben Haushalt. Ein eigener Wunsch wird nur
	// mit den eigenen verglichen: ein Treffer unter den Ideen anderer verriete,
	// dass jemand eine hat. Eine Idee fuer X dagegen mit allem bei X -- das
	// sieht ihr Autor ohnehin. Der Unique-Index (`household`, `wisher`,
	// `author`, `text_norm`) haelt nur den ersten Fall gegen Gleichzeitigkeit.
	const household = e.record.getString('household');
	if (wisher && norm) {
		let existing = null;
		try {
			existing = own
				? e.app.findFirstRecordByFilter(
						'wishes',
						'household = {:household} && wisher = {:wisher} && author = {:wisher} && text_norm = {:norm}',
						{ household: household, wisher: wisher, norm: norm }
					)
				: e.app.findFirstRecordByFilter(
						'wishes',
						'household = {:household} && wisher = {:wisher} && text_norm = {:norm}',
						{ household: household, wisher: wisher, norm: norm }
					);
		} catch (err) {
			// findFirstRecordByFilter wirft ("sql: no rows in result set"), statt
			// null zu liefern -- kein Treffer ist hier der Normalfall.
		}

		if (existing) {
			// Den vorhandenen Wortlaut mitgeben: beim eigenen Wunsch stammt er von
			// derselben Person, bei einer Idee steht er sichtbar in der Liste --
			// er verraet also nichts, und ohne ihn bliebe die Meldung ein Raetsel.
			const message =
				(own ? 'Das steht schon auf deiner Liste: „' : 'Das steht schon auf der Liste: „') +
				existing.getString('text') +
				'“';

			// Der Feldfehler *muss* ein `ValidationError` sein. Ein einfaches
			// `{ code, message }` haelt PocketBase fuer eine verschachtelte Map und
			// ersetzt beide Werte durch „Invalid value." -- der eigene Text ist dann
			// weg, ohne dass irgendwo ein Fehler stuende.
			throw new BadRequestError(message, {
				text: new ValidationError('wish_duplicate', message)
			});
		}
	}

	e.next();
}, 'wishes');

// Wie viele Wuensche habe *ich* in diesem Haushalt abgesetzt?
//
// Das braucht eine eigene Route: die ListRule liefert die eigenen Wuensche
// nicht aus, der Client kann sie also nicht zaehlen. Hier kommt ausschliesslich
// die Zahl heraus -- kein Text, keine ID, kein Datum. Genau das ist der
// Kompromiss: die Person soll wissen, *dass* etwas auf ihrer Liste steht, ohne
// zu erfahren, *was*.
routerAdd(
	'GET',
	'/api/wishes/mine/count',
	(e) => {
		// `e.auth` steht dank requireAuth -- gezaehlt wird immer der eigene
		// Bestand, der Client kann keine andere Person angeben.
		//
		// Den Haushalt nennt der Client (`?household=`). Eine Mitgliedschaft muss
		// hier nicht geprueft werden: gezaehlt werden nur eigene Wuensche, und
		// die liegen ohnehin nur dort, wo man Mitglied war.
		//
		// `author` muss mit: Ideen, die andere fuer mich notiert haben, stehen
		// ebenfalls auf `wisher = ich` -- mitgezaehlt verriete die Zahl sie.
		const household = e.request.url.query().get('household');
		if (!household) throw new BadRequestError('household fehlt');
		const count = e.app.countRecords(
			'wishes',
			$dbx.hashExp({ wisher: e.auth.id, author: e.auth.id, household: household })
		);
		return e.json(200, { count: count });
	},
	$apis.requireAuth()
);
