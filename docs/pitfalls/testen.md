# Beim Testen

Lesen, bevor du die App lokal startest oder im Browser verifizierst.

## Weiße Seite mit `TypeError: Cannot read properties of undefined (reading 'data')`

Kein Svelte-Fehler, sondern ein zerrissener Build in `pb/pb_public/`: SvelteKit legt
seinen Laufzeit-Zustand unter einem pro Build neu gewürfelten Global `__sveltekit_<hash>`
ab, das `index.html` inline setzt und die Chunks lesen. Laufen zwei Builds ineinander
(z.B. zwei Sessions parallel), passt das `index.html` des einen nicht zu den Chunks des
anderen und die Hydration stirbt an der ersten Zeile. Prüfen statt raten:

```bash
grep -ro "__sveltekit_[a-z0-9]*" pb/pb_public | sed 's/.*://' | sort -u
```

Muss **genau einen** Namen ausgeben. Heilmittel ist ein erneutes `build.sh`.

## Server starten

* **Ein mit `(cmd &)` in den Hintergrund geschickter Server überlebt den Bash-Aufruf
  nicht.** Symptom: Minuten später schlagen alle Requests fehl, und im Browser sieht man
  genau die Symptome des `--no-sandbox`-Falls unten (kein `fetch`, kein Service Worker) —
  weil die Seite nur eine Fehlerseite ist. PocketBase für Tests über das
  `run_in_background` des Bash-Tools starten und mit `/api/health` prüfen, *bevor* man
  einem Browserergebnis glaubt.
* **Umlaute in Bash-`curl`-Payloads werden auf Windows zerlegt**, PocketBase antwortet mit
  einem nichtssagenden `400`. Für Requests mit Umlauten (z.B. `category:"Obst/Gemüse"`)
  `node -e "fetch(…)"` benutzen, Token per Env-Variable übergeben.
* **Nach dem Löschen von `pb_data/` sieht die App eingeloggt aus, zeigt aber eine leere
  Liste.** Der Token im localStorage überlebt den DB-Reset, ist gegen die neue DB aber
  ungültig — jeder Request läuft in ein 401. Einmal abmelden, neu anmelden.
* Testdaten liegen in `pb/pb_data/` — zum Zurücksetzen den Ordner löschen und den
  Superuser neu anlegen.

## Browser

* **Der eingebettete Browser-Pane blockiert Service-Worker-Registrierung** und lässt
  Klicks in 30s-Timeouts laufen. Das ist kein App-Bug. Für echte Verifikation den
  Playwright-MCP nehmen.
* **Der Playwright-MCP lädt nur Dateien aus dem Projektordner hoch.** Symptom:
  `File access denied: … is outside allowed roots`. Testbilder also im Repo ablegen (und
  hinterher wegräumen), nicht im Temp-Ordner.
* **Headless-Chromium bekommt echte FCM-Abos** (`fcm.googleapis.com/preprod/wp/…`), aber
  das erste `subscribe()` dauert bis zu 30 s, und die Zustellung klappt nicht immer. Kommt
  keine Meldung an, erst ins `_logs` schauen: steht dort kein „Push abgelehnt", hat der
  Dienst die Nachricht angenommen und es ist ein Headless-Effekt.

### Ausweg: Chromium selbst per CDP fahren

Der Playwright-MCP-Browser kann von einer *parallelen* Session belegt sein
(`Browser is already in use for …, use --isolated`). Ohne Warten geht es direkt: die
Playwright-Binary liegt unter
`%LOCALAPPDATA%\ms-playwright\chromium-*/chrome-win64/chrome.exe`, Node ≥ 22 hat ein
globales `WebSocket`, mehr braucht es nicht (`--remote-debugging-port`, dann `/json/list`
und `Target.attachToTarget`). Drei Fallen:

* **Ohne `--no-sandbox` stirbt der Netzwerkdienst dieses Builds beim Start** („Sandbox
  cannot access executable … Access is denied", dann „Network service crashed"). Die Seite
  ist danach ein Fehlerdokument mit *korrekter* URL — `fetch` schlägt fehl und
  `navigator.serviceWorker` ist `undefined`, was wie ein App-Problem aussieht.
* **Ziel über `/json/list` suchen, nicht über `Target.getTargets`.** Chromium führt neben
  dem Tab eigene WebUI-Seiten als Ziel; hängt man am falschen, gilt dasselbe Symptom wie
  oben. `/json/list` liefert die URL mit.
* **`ServiceWorker.deliverPushMessage` braucht die Page-Session** (`sessionId`), nicht die
  Browser-Session — sonst `'ServiceWorker.deliverPushMessage' wasn't found`. Damit lässt
  sich der `push`-Handler ohne echten Push-Dienst auslösen.
