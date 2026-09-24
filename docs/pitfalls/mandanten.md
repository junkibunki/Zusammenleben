# Haushalte (Mandanten)

Lesen, bevor du eine Rule schreibst, die auf `memberships` prüft, oder eine neue
Collection anlegst, die pro Haushalt getrennt sein soll.

## Modell

`households` (nur `name`) und `memberships` (`user`, `household`, `role` = `haupt`|`gast`,
`until`). Gepflegt im Admin-UI, alle Schreib-Rules `null`. „Höchstens ein Haupthaushalt"
ist der partielle Unique-Index `idx_memberships_main … WHERE role = 'haupt'`, kein Hook.
Laufend ist eine Mitgliedschaft mit leerem oder künftigem `until`; abgelaufene Zeilen
bleiben stehen und öffnen nichts mehr.

## Rules: ein Alias pro Mitgliedschaft

Alle Bedingungen, die dieselbe Mitgliedschaft meinen, laufen über **denselben** Alias
(`@collection.memberships:mine.…`) und mit `?=`/`?>`. Dann treffen sie dieselbe Zeile —
nachgemessen: ein Nutzer mit abgelaufener Mitgliedschaft in H1 und laufender in H2 bekommt
auf H1 404, auf H2 200. Wer zwei Mitgliedschaften vergleicht (Mitbewohner in `users`),
braucht zwei Aliase (`mine`, `theirs`). Die fertigen Bausteine stehen oben in
`1789304400_households.js` (`memberOf`, `ACTIVE`, `KEEP_HOUSEHOLD`).

## Checkliste für eine neue Collection pro Haushalt

* Feld `household` (Relation, required, `cascadeDelete: true`) und alle Rules über
  `memberOf('household')`; `updateRule` zusätzlich mit `KEEP_HOUSEHOLD`.
* Client: `household: households.activeId` beim `create`; `getFullList` **und**
  `subscribe` mit `filter: household = …`, im Callback zusätzlich `e.record.household`
  prüfen — sonst kommen die Events der Gast-Haushalte in die falsche Liste.
* Store merkt sich `loadedFor` (Haushalt) statt `loadedOnce` und leert die Liste bei
  einem Wechsel, sonst steht kurz der alte Haushalt da (bei Ausgaben: in fremden Salden).
* Relations auf `users`, die aus dem Request kommen (`paid_by`, `shared_with`), prüft die
  Rule nicht — dafür `pb_hooks/expenses.pb.js` als Vorbild.
* Push nur an Mitglieder: `householdSubscriptions()` in `push-lib.js`.
