/// <reference path="../pb_data/types.d.ts" />

// Likes im Ideen-Feed (Migration 1789736400): jeder darf nur sich selbst
// hinzufuegen oder entfernen, und die eigene Idee zaehlt nicht.
//
// Die UpdateRule kann das nicht ausdruecken -- sie sieht den neuen Wert, aber
// keinen Vergleich mit dem alten. Hier liegen beide: `e.record` mit den
// Modifiern (`likes+`/`likes-`) schon angewendet, `e.record.original()` davor.
//
// Dafuer steht auch `author` fest: wer die Idee postet, ist ihr Autor, und das
// aendert sich nicht mehr. Sonst liesse sich die eigene Idee kurz jemand anderem
// zuschreiben, liken und zurueckholen. Die CreateRule liest `author` nicht,
// der Hook darf das Feld also selbst setzen (docs/pitfalls/pocketbase-hooks.md).
//
// Superuser (Admin-UI) duerfen alles, wie ueberall sonst.
//
// Alles steht in den Callbacks selbst: PocketBase fuehrt sie in einer eigenen
// JS-VM aus, die den Modulscope dieser Datei nicht kennt.

onRecordCreateRequest((e) => {
	// Eine neue Idee startet ohne Likes -- sonst koennte man sie vorbelegt posten.
	if (!e.hasSuperuserAuth()) {
		e.record.set('author', e.auth ? e.auth.id : '');
		e.record.set('likes', []);
	}
	e.next();
}, 'ideas');

onRecordUpdateRequest((e) => {
	if (!e.hasSuperuserAuth()) {
		const me = e.auth ? e.auth.id : '';

		if (e.record.getString('author') !== e.record.original().getString('author')) {
			const message = 'Der Autor einer Idee lässt sich nicht ändern.';
			throw new BadRequestError(message, {
				author: new ValidationError('author_fixed', message)
			});
		}

		const before = e.record.original().getStringSlice('likes');
		const after = e.record.getStringSlice('likes');

		const added = after.filter((id) => before.indexOf(id) === -1);
		const removed = before.filter((id) => after.indexOf(id) === -1);
		const foreign = added.concat(removed).some((id) => id !== me);

		if (foreign) {
			const message = 'Du kannst nur deinen eigenen Like setzen oder entfernen.';
			throw new BadRequestError(message, {
				likes: new ValidationError('likes_foreign', message)
			});
		}

		if (added.length > 0 && e.record.getString('author') === me) {
			const message = 'Die eigene Idee kannst du nicht liken.';
			throw new BadRequestError(message, {
				likes: new ValidationError('likes_own', message)
			});
		}
	}

	e.next();
}, 'ideas');
