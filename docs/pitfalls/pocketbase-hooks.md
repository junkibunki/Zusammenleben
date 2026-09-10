# PocketBase-Hooks

Lesen, bevor du einen Request-Hook in `pb/pb_hooks/` schreibst.

Wie eine neue Hook-Datei überhaupt geladen wird (Neustart nötig, `touch` genügt nicht),
steht in [migrationen.md](migrationen.md#fallstricke).

## Die API-Rule läuft *vor* dem Hook

Symptom: `create rule failure: sql: no rows in result set` im `_logs`, Antwort ein nacktes
`{"data":{},"message":"Failed to create record.","status":400}` — und der Hook, der das
fehlende Feld setzen sollte, hat nie geloggt. Nicht weiter suchen, warum der Hook nicht
registriert ist: er ist registriert, er kommt nur nicht mehr dran.

`onRecordCreateRequest` feuert erst, wenn die CreateRule schon zugestimmt hat. Ein Feld,
auf das die Rule sich bezieht, kann der Hook also nicht beisteuern — es muss aus dem
Request kommen. Bei `wishes` schickt der Client `wisher` deshalb selbst mit, und die Rule
`wisher = @request.auth.id` weist jeden anderen Wert ab (nachgemessen: 400). Das
PocketBase-Beispiel `e.record.set("status", "pending")` täuscht hier — es funktioniert nur,
weil keine Rule `status` liest.

Umgekehrt heißt das: was nur die Rule prüfen kann, gehört in die Rule, nicht in einen Hook.
Ein Hook als einzige Sperre wäre auch die schwächere Variante — er fällt mit seiner Datei
aus, die Rule steht in der Datenbank.

## Ein Feldfehler muss ein `ValidationError` sein

Symptom: `throw new BadRequestError('…', { text: { code: 'x', message: 'y' } })` kommt beim
Client als `data.text = {"code":{"code":"validation_invalid_value","message":"Invalid
value."}, "message":{…}}` an — der eigene Text ist weg, und zwar lautlos. PocketBase hält
die einfache Map für eine verschachtelte Fehlerstruktur und ersetzt die Blätter.

Richtig ist der eigene Typ; er wird zu genau dem `{code, message}`, das das SDK unter
`err.response.data.<feld>` erwartet:

```js
throw new BadRequestError(message, { text: new ValidationError('wish_duplicate', message) });
```

Die `message` des `BadRequestError` steht zusätzlich als `response.message` in der Antwort
(PocketBase hängt einen Punkt an) — als Notausgang, wenn die Seite keinen Feldbezug braucht.

## `/api/logs` findet den eigenen Log-Eintrag nicht

Symptom: `filter=message~"WISHDBG"` liefert `totalItems: 0`, dieselbe Abfrage ohne Filter
zeigt den Eintrag zwei Zeilen weiter oben. Also nicht nach dem Text filtern, sondern
`?perPage=30&sort=-created` holen und in Node über `items` gehen. Und beim Suchen nach
einem eigenen Hook-Log: die Server-Konsole (`> datei 2>&1`) zeigt nur `console.log`,
`e.app.logger()` schreibt ausschließlich in `_logs`.
