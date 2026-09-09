# PocketBase-Migrationen

Lesen, bevor du eine Migration in `pb/pb_migrations/` anlegst oder änderst.

## API-Stand

* v0.23+: `migrate((app) => { … }, (app) => { … })`, Collections über
  `new Collection({ …, fields: [...] })`, gespeichert mit `app.save(collection)`.
* Das `id`-Feld explizit mitgeben (`system: true, primaryKey: true`) — es entsteht nicht
  automatisch.
* Relations brauchen eine `collectionId`. Zur Laufzeit holen
  (`app.findCollectionByNameOrId('users').id`), nicht hardcoden.
* `bool` kennt kein `default`. "Nicht gesetzt" ist `false`, das genügt.

## Fallstricke

**Migrationen laufen bei *jedem* Bootstrap**, auch bei `superuser upsert`, nicht nur bei
`serve`. Eine Migration darf deshalb nicht werfen, wenn das Erwartete fehlt: ein
`users.fields.getByName('x').y = …` auf ein nicht vorhandenes Feld nimmt die ganze App
mit runter statt nur die Migration. Erst holen, prüfen, dann setzen.

**Eine Migration mit kleinerer Nummer nachschieben ist unkritisch.** PocketBase führt
Buch pro Datei (Tabelle `_migrations`), nicht über einen Höchststand: `1756000004` lief
auch dann noch an, als `1756000005` schon angewendet war (nachgemessen). Nur wenn zwei
Migrationen dasselbe Feld anfassen, muss man die Reihenfolge selbst durchdenken.

**Ein Feld ändern statt anlegen:** `fields.getByName(…)` liefert eine echte Referenz,
keine Kopie — mutieren und `app.save(collection)` genügt (so setzt `1756000003` die
`thumbs` des `avatar`-Feldes). Der von PocketBase selbst generierte
`fields.addAt(index, new Field({…}))`-Stil braucht dagegen die volle Feld-JSON inklusive
`id` und die richtige Position.

**Die Werte eines `select`-Feldes ändern heißt auch: Bestandsdaten umschreiben.**
PocketBase prüft beim Speichern den *ganzen* Record, nicht nur die geschickten Felder —
ein Item mit einem Wert, der nicht mehr in `values` steht, ließe sich also nicht mehr
abhaken. Umschreiben in derselben Migration per
`app.db().newQuery('UPDATE …').execute()` (so `1756000005`: alte Warengruppen →
`Supermarkt`).

**`migrate up` sagt „No new migrations to apply", *nachdem* es die Migration ausgeführt
hat.** Das Kommando bootstrappt die App, der Bootstrap führt die offenen Migrationen
selbst aus; die eigentliche Prüfung läuft danach und findet nichts mehr. Kein Grund zu
suchen, warum `up` nichts tut — nachsehen, ob die Änderung schon da ist.

**Ein `grep` in `pb_data/data.db` beweist nichts.** Frische Änderungen stehen im WAL
(`data.db-wal`). Symptom: die neuen Enum-Werte sind „nicht da", obwohl die Migration
lief. Zum Prüfen einen temporären Hook in `pb_hooks/` legen, der in `onBootstrap` über
`$app` liest, und ihn hinterher löschen. Dabei lieferte
`$app.db().newQuery(…).all(arr, new DynamicModel(…))` still nichts;
`$app.findAllRecords('items')` funktioniert.

**Ein Prüf-Hook in `onBootstrap` sieht eine *neue* Collection nicht.** Symptom:
`GoError: sql: no rows in result set` aus `findCollectionByNameOrId('…')`, obwohl die
Migration in derselben Sitzung lief — `onBootstrap` (auch nach `e.next()`) ist früher als
die Migrationen. Beim Nachsehen, ob eine Collection *angelegt* wurde, also nicht in
`onBootstrap` lesen, sondern eine temporäre Route registrieren
(`routerAdd('GET', '/zz-tmp-check', (e) => e.json(200, …))`) und sie per `fetch` abrufen;
dort liegt der fertige Stand. Zwei Dinge dabei:

**Eine neu angelegte Hook-Datei wird nicht eingelesen**, `touch` genügt auch nicht — der
Server muss neu starten. Erst die Datei schreiben, *dann* `serve`.

**Eine Migration erneut anwenden** heißt: mit `migrate down 1` zurücknehmen und beim
nächsten Start wieder hochlaufen lassen. `down` fragt interaktiv nach und braucht deshalb
ein `echo "y" |` davor, sonst bricht es mit „The command has been cancelled" ab.

## API-Rules

`expand` kommt leer zurück, wenn die View-Rule der Zielcollection zumacht — Details in
[Realtime / PocketBase-SDK](../../CLAUDE.md#realtime--pocketbase-sdk). Für `users`
öffnet `1756000002` die ViewRule, `1756000004` die ListRule (die Seite „Bewohner"
braucht sie, sonst liefert `getFullList('users')` nur den eigenen Datensatz).
