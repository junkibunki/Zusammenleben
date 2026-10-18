/// <reference path="../pb_data/types.d.ts" />

// "Muessen wir mal machen" (Migration 1790082000): wer was aendern darf, und
// Push bei neuem Termin oder Kommentar.
//
// Die UpdateRule sieht nur den neuen Wert. Hier liegen beide: `e.record` mit
// den Modifiern (`interested+`/`interested-`) schon angewendet,
// `e.record.original()` davor.
//
// * `author` steht fest.
// * `interested`: jeder nur sich selbst.
// * Titel, Art, Notiz, Link, Sichtbarkeit: nur der Autor.
// * Termin und "gemacht": der Autor und wer (nach diesem Update) dabei ist.
//   `done_by` ist immer, wer abhakt.
//
// Superuser (Admin-UI) duerfen alles, wie ueberall sonst.
//
// Alles steht in den Callbacks selbst: PocketBase fuehrt sie in einer eigenen
// JS-VM aus, die den Modulscope dieser Datei nicht kennt.

onRecordCreateRequest((e) => {
	if (!e.hasSuperuserAuth()) {
		// Wer etwas vorschlaegt, ist dabei; sonst niemand -- und gemacht ist
		// ein neuer Eintrag auch noch nicht.
		e.record.set('interested', e.auth ? [e.auth.id] : []);
		e.record.set('done_at', '');
		e.record.set('done_by', '');
	}
	e.next();
}, 'together');

onRecordUpdateRequest((e) => {
	const me = e.auth ? e.auth.id : '';
	const before = e.record.original();
	const plannedBefore = before.getString('planned_at');

	if (!e.hasSuperuserAuth()) {
		const fail = (field, code, message) => {
			throw new BadRequestError(message, { [field]: new ValidationError(code, message) });
		};
		const changed = (field) => e.record.getString(field) !== before.getString(field);

		if (changed('author')) fail('author', 'author_fixed', 'Der Autor lässt sich nicht ändern.');

		const was = before.getStringSlice('interested');
		const now = e.record.getStringSlice('interested');
		const added = now.filter((id) => was.indexOf(id) === -1);
		const removed = was.filter((id) => now.indexOf(id) === -1);
		if (added.concat(removed).some((id) => id !== me)) {
			fail('interested', 'interested_foreign', 'Du kannst nur dich selbst ein- oder austragen.');
		}

		const isAuthor = e.record.getString('author') === me;
		const fields = ['title', 'kind', 'note', 'link', 'household'];
		for (let i = 0; i < fields.length; i++) {
			if (!isAuthor && changed(fields[i])) {
				fail(fields[i], 'author_only', 'Das kann nur ändern, wer den Eintrag angelegt hat.');
			}
		}

		const planChanged = changed('planned_at') || changed('done_at') || changed('done_by');
		if (planChanged && !isAuthor && now.indexOf(me) === -1) {
			fail('planned_at', 'not_in', 'Termin und Erledigt setzen nur, wer dabei ist.');
		}

		if (changed('done_at') || changed('done_by')) {
			const done = e.record.getString('done_at') !== '';
			const by = e.record.getString('done_by');
			if (done ? by !== me : by !== '') {
				fail('done_by', 'done_by_self', 'Abhaken kannst du nur in deinem eigenen Namen.');
			}
		}
	}

	e.next();

	// Neuer oder verschobener Termin -- nach e.next() ist er gespeichert.
	const planned = e.record.getString('planned_at');
	if (planned && planned !== plannedBefore) {
		try {
			require(`${__hooks}/push-lib.js`).notifyTogetherPlanned(e.app, e.record, me);
		} catch (err) {
			e.app.logger().error('Push zu Termin fehlgeschlagen', 'fehler', String(err));
		}
	}
}, 'together');

onRecordCreateRequest((e) => {
	e.next();
	try {
		require(`${__hooks}/push-lib.js`).notifyTogetherComment(e.app, e.record, e.auth?.id);
	} catch (err) {
		// Der Kommentar steht schon -- ein Push-Problem darf die Antwort nicht
		// zu einem Fehler machen.
		e.app.logger().error('Push zu Kommentar fehlgeschlagen', 'fehler', String(err));
	}
}, 'together_comments');
