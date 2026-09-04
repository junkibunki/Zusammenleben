# PWA und Web Push

Lesen, bevor du am Service Worker, an `push.svelte.js` oder an `pb/pb_hooks/` arbeitest.

## PWA

* SvelteKit registriert `src/service-worker.js` im Production-Build automatisch — keine
  eigene Registrierung ins `app.html` schreiben.
* Der `fetch`-Handler muss existieren (sonst kein Install-Prompt in Chrome), darf aber
  trivial durchreichen. Kein Caching gewollt. `push` und `notificationclick` stehen in
  derselben Datei.
* **Im Dev-Modus registriert SvelteKit den Worker nicht**, und
  `navigator.serviceWorker.ready` wartet dann *für immer*, statt zu scheitern.
  `push.svelte.js` registriert ihn deshalb unter `dev` selbst
  (`register('/service-worker.js', { type: 'module' })`) — im Produktionsbuild ist
  derselbe Aufruf ein No-op, weil Scope und URL schon belegt sind.
* `manifest.webmanifest` wird von PocketBase mit dem MIME-Typ des OS ausgeliefert
  (Windows: `text/plain`). Chrome prüft den Manifest-MIME-Typ nicht — kein Handlungsbedarf.
* Icons neu bauen: `cd frontend && node scripts/generate-icons.mjs`. Quelle ist
  `frontend/scripts/icon-source.png`, Ausgabe `icon-32/192/512.png` in `static/`.

## Web Push — Aufbau

Ein neuer Eintrag löst eine Benachrichtigung an alle *anderen* Nutzer aus.
Verschickt wird serverseitig aus einem PocketBase-Hook, ohne fremden Dienst: Web Push nach
**RFC 8291** (Nutzlast als `aes128gcm`) und **RFC 8292** (VAPID/ES256). Empfänger sind die
Push-Dienste der Browser (FCM, Mozilla Autopush, Apple).

* Collection **`push_subscriptions`**: ein Datensatz pro Gerät (`endpoint` mit
  Unique-Index, `p256dh`, `auth`, `device`). Alle Rules auf `user = @request.auth.id`.
* Collection **`push_config`**: genau ein Record `vapid` mit dem Schlüsselpaar des
  Servers, beim ersten Start selbst erzeugt. Ohne API-Rules (`null` = nur Superuser); der
  öffentliche Teil kommt über `GET /api/push/key` heraus. Der private Schlüssel liegt im
  Klartext in `pb_data` — bewusst, dort stehen auch die Passwort-Hashes.
* `POST /api/push/test` schickt eine Probe an die *eigenen* Geräte. Ohne so einen Knopf
  lässt sich die Kette Browser → Push-Dienst → Gerät mit einem Gerät nicht prüfen.
* Ein abgelaufenes Abo (404/410 vom Dienst) wird serverseitig gelöscht.
* Nach `npm run test:hooks` läuft der Selbsttest der Krypto gegen den Testvektor aus
  RFC 8291 §5 — der prüft die Verschlüsselung bytegenau.

**Das Schlüsselpaar muss stabil bleiben**: die Abos der Browser hängen daran. Ein neues
Paar (z.B. nach `rm -rf pb_data`) macht jedes vorhandene Abo ungültig, der Push-Dienst
antwortet mit 403. `refreshPush()` merkt das beim Laden der Profilseite (Vergleich mit
`subscription.options.applicationServerKey`) und meldet das Gerät ab, statt
„eingeschaltet" anzuzeigen und still nichts mehr zu liefern.

**Abmelden muss das Abo mitnehmen.** `logout()` ruft vorher `unsubscribeThisDevice()`;
danach fehlt das Token dafür. Ohne das zeigt ein abgemeldetes Gerät weiter jede neue Zeile
an — Abo und Datensatz bleiben ja gültig. Der Import ist dynamisch, sonst gäbe es einen
Zyklus (`push.svelte.js` braucht `pb`).

**Bekannte Grenze:** auf dem iPhone gibt es Web Push nur in der installierten PWA
(iOS 16.4+). In Safari als Tab fehlt `PushManager` einfach — kein Fehler, kein Hinweis.
Die Profilseite sagt das darum von sich aus, wenn `supported` false ist und der
User-Agent nach iOS aussieht.

## Fallstricke der PocketBase-JS-VM (alle real aufgetreten)

**Ein Hook-Callback sieht den Modulscope seiner Datei nicht.** PocketBase führt jeden
Callback in einer eigenen JS-VM aus. Eine Funktion daneben zu definieren und darin
aufzurufen endet in `ReferenceError: <name> is not defined` — erst zur Laufzeit, beim
Bootstrap als stiller Log-Eintrag, bei einer Route als nacktes `400`. Alles Gemeinsame
muss in ein Modul, das *innerhalb* des Callbacks geladen wird
(``require(`${__hooks}/push-lib.js`)``). Daher die Trennung push.pb.js / push-lib.js.

**`require()` löst `node_modules` nicht auf**, nur relative Pfade — ein Paket dort
abzulegen bringt `GoError: Invalid module`. Deshalb wird die Krypto zu *einer* Datei
gebündelt (`frontend/scripts/build-webpush.mjs` → `pb/pb_hooks/webpush.js`, im Repo, damit
der Server kein npm braucht).

**Binäre Daten gehen nur als `Uint8Array` durch `$http.send`.** Ein „Binärstring" wird
beim Übergang nach Go als UTF-8 kodiert — nachgemessen: 6 Bytes (`00 41 80 ff c3 28`)
kommen als 9 an (`0041c280c3bfc38328`). Ein `ArrayBuffer` kommt als **leerer** Body an,
ohne Fehler. Ein verschlüsselter Push-Body ist damit stiller Datenmüll. Dieselbe
UTF-8-Falle macht `$security.sha256` & Co. für beliebige Bytes unbrauchbar; für ASCII
(z.B. das Ergebnis von `randomString`) sind sie in Ordnung.

**Die JS-VM hat keine WebCrypto** (`crypto` und `TextEncoder` sind `undefined`), also
reine JS-Krypto. Zufall kommt aus `$security.randomString` (crypto/rand, aber nur
alphanumerisch) und wird per SHA-256 zu gleichverteilten Bytes — Polyfill im Banner des
Bundles.

**Kein `setTimeout`, keine Goroutine.** Der Versand läuft synchron im Request des
Anlegenden mit. Gemessen: ein `create` mit drei Empfängern dauert 260–470 ms statt ~40 ms.
Für eine Einkaufsliste in Ordnung; bei hundert Empfängern braucht es einen anderen Weg.

**`app.logger()` schreibt nicht nach stdout**, sondern in die `_logs`-Collection. Ansehen
mit `GET /api/logs?perPage=20&sort=-created` als Superuser; die Zeilen erscheinen mit ein
paar Sekunden Verzögerung.

**`res.body` einer `$http.send`-Antwort ist ein Byte-Array.** Im Log steht dann
`"112,101,114,109,…"` statt Text. Vor dem Loggen dekodieren — genau diese Meldung des
Push-Dienstes sagt, was los ist.

**Änderungen in `pb_hooks/` wirken erst nach einem Neustart.** PocketBase schreibt nur
`File … changed, please restart the app manually` und läuft mit dem alten Code weiter.
Zwei Stunden Fehlersuche wert.

## Signatur: `@noble/curves` v2 hasht selbst

**Symptom:** FCM antwortet `403 permission denied: invalid JWT provided`. Uhr stimmt, `aud`
stimmt, `exp` liegt innerhalb von 24 h, `sub` ist gültig — und `p256.verify()` bestätigt
die eigene Signatur als gültig.

**Ursache:** In `@noble/curves` v2 ist `prehash` in `sign()` standardmäßig an. Wer
`p256.sign(sha256(msg), key)` schreibt, hasht zweimal; die Signatur ist damit nicht
ES256-konform. `p256.verify(sig, sha256(msg), pub)` macht denselben Fehler ein zweites Mal
und bestätigt sie — der Test ist mit sich selbst einig und mit niemandem sonst. Richtig
ist `p256.sign(msg, key)` (oder `{ prehash: false }` mit dem Hash).

**Lehre:** eine Signatur *nie* mit der Bibliothek prüfen, die sie erzeugt hat.
`frontend/scripts/webpush.test.mjs` prüft sie darum mit Node WebCrypto — das ist die
Zeile, die den Fehler gefunden hat.
