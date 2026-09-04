/// <reference path="../pb_data/types.d.ts" />

// Seite "Bewohner": wer eingeloggt ist, darf die anderen Nutzer auflisten.
// 1756000002 hatte nur die ViewRule geoeffnet (fuer `expand`) und die ListRule
// bewusst eng gelassen. Fuer eine Uebersicht aller Accounts reicht das nicht --
// mit der engen Rule liefert `getFullList()` nur den eigenen Datensatz.
//
// Neu ist damit die Aufzaehlbarkeit: ein eingeloggter Nutzer kann die
// Collection auflisten, nach sichtbaren Feldern filtern und sie im Realtime
// abonnieren. Die *Felder* bleiben, wie sie waren -- die E-Mail zeigt PocketBase
// weiter nur beim eigenen Record bzw. bei gesetztem `emailVisibility`, und zwar
// auch im Filter (nachgemessen: `filter=email="..."` auf einen fremden Account
// liefert 0 Treffer, statt seine Existenz zu bestaetigen). Fuer eine
// Einkaufsliste ist das der richtige Tausch; wer es enger braucht, liefert die
// Uebersicht ueber einen eigenen Hook-Endpunkt aus, der nur `id`, `name`,
// `avatar` und `created` zurueckgibt.
migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		users.listRule = '@request.auth.id != ""';
		app.save(users);
	},
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		users.listRule = 'id = @request.auth.id';
		app.save(users);
	}
);
