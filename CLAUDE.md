# CLAUDE.md — Familien-Einkauf

Notizen für zukünftige Sessions. Ergänzt das [README](README.md) (das erklärt Setup und
Deploy für Menschen); hier steht, was beim Arbeiten am Code stolpert.

## Workflow

### Review vor jedem Commit

* **Vor dem Committen muss ein unabhängiger Subagent ohne Vorwissen das Entwickelte
  reviewen.**
* Der Agent bekommt **nur eine kurze Einleitung zur Anforderung an das Feature** — nicht,
  was umgesetzt wurde, nicht welche Dateien betroffen sind, keine Begründungen. Er soll
  unvoreingenommen gegen die Anforderung prüfen, nicht die eigene Erzählung bestätigen.
* **Nur committen, wenn der Agent grünes Licht gibt.** Bei Findings: erst beheben, dann
  erneut reviewen lassen.

### Pitfalls dokumentieren

* **Wenn du bei der Entwicklung in einen Pitfall trittst, dokumentiere ihn** — in diesem
  File, im passenden Abschnitt weiter unten.
* Gemeint ist alles, was Zeit gekostet hat, weil es nicht offensichtlich war: eine
  Fehlermeldung, die in die Irre führt, eine API, die sich anders verhält als erwartet,
  ein Tool-/Umgebungsproblem, das wie ein Bug im Code aussieht.
* Notiere **Symptom und Ursache**, nicht nur die Lösung — beim nächsten Mal erkennt man
  den Fall am Symptom wieder.
* Kein Pitfall ist: was der Code oder die git-History ohnehin schon zeigt.

## Struktur

```
/
├── frontend/                      # SvelteKit, Svelte 5 Runes, SPA
│   ├── svelte.config.js           # adapter-static, Output -> ../pb/pb_public
│   ├── vite.config.js             # Dev-Proxy /api + /_ -> 127.0.0.1:8090
│   ├── scripts/generate-icons.mjs # PNG-Icons ohne Dependencies (node:zlib)
│   ├── static/                    # manifest.webmanifest + 3 Icons
│   └── src/
│       ├── app.html               # PWA-Metas
│       ├── app.css                # globales CSS, mobile-first
│       ├── service-worker.js      # trivialer Pass-through, SvelteKit registriert ihn selbst
│       ├── lib/
│       │   ├── pocketbase.svelte.js  # PB-Client + reaktiver authStore-Spiegel
│       │   └── items.svelte.js       # $state der Liste + Realtime
│       └── routes/                # +layout.js (ssr=false), +layout.svelte (Guard),
│                                  # +page.svelte (Liste), login/+page.svelte
├── pb/
│   ├── pocketbase(.exe)           # gitignored, v0.23+ nötig (getestet: 0.40.2)
│   ├── pb_migrations/             # JS-Migrationen, laufen beim Start automatisch
│   ├── pb_data/                   # gitignored, die SQLite-DB
│   └── pb_public/                 # gitignored, Build-Output
├── .github/workflows/deploy.yml   # Build + Deploy auf den VPS bei Push auf main
├── build.sh                       # frontend -> pb/pb_public
└── README.md
```

Ein Prozess serviert alles: PocketBase liefert `pb_public/` inkl. SPA-Fallback auf
`index.html`, dazu die API unter `/api` und das Admin-UI unter `/_`.

## Svelte-5-Fallstricke (alle hier real aufgetreten)

* **Runes nur in `.svelte` und `.svelte.js`.** `$state` in einer normalen `.js` wird nicht
  kompiliert. Deshalb heißen die Lib-Dateien `pocketbase.svelte.js` und `items.svelte.js`.
* **Kein Export einer neu zugewiesenen `$state`-Variablen.** `export let items = $state([])`
  ist `state_invalid_export`. Lösung: ein `$state`-Objekt exportieren
  (`export const store = $state({ items: [] })`) und dessen Properties mutieren.
* **`$effect` braucht einen Effekt-Kontext.** Auf Modulebene aufgerufen wirft es
  `effect_orphan`. `items.svelte.js` exportiert daher `syncItems()`, das Laden +
  Subscription startet und das Teardown zurückgibt; `+page.svelte` ruft es aus seinem
  `$effect` auf.
* **Vite-Plugin-Import:** `import { sveltekit } from '@sveltejs/kit/vite'` — *nicht*
  aus `@sveltejs/vite-plugin-svelte`, das exportiert kein `sveltekit`.

## Realtime / PocketBase-SDK

* **Immer nur einzelne Items mutieren** (`push` / `splice` / `items[i] = …`), nie
  `items = items.filter(...)`. Sonst überschreiben sich gleichzeitige Änderungen zweier
  Personen gegenseitig.
* **Create-Events deduplizieren.** `pb.create()` liefert den Record zurück *und* die
  Subscription feuert ein `create`-Event für denselben Record — ohne `findIndex`-Check
  steht der Eintrag doppelt in der Liste.
* **`pb.authStore.record`**, nicht `.model` (seit SDK 0.22).
* **`expand` kommt leer zurück, wenn die View-Rule der Zielcollection zumacht.** Symptom:
  `record.expand` ist `{}`, kein Fehler, kein Log. Ursache bei `users`: die Standard-Rule
  `id = @request.auth.id` lässt nur den eigenen Datensatz durch. Migration
  `1756000002` öffnet die ViewRule für Eingeloggte; die ListRule bleibt eng.
* **`expand` muss an *jeden* Call**, sonst fehlt der Name genau im ungetesteten Pfad:
  `getFullList({ expand })`, `create(data, { expand })`, `update(id, data, { expand })`
  und — leicht übersehen — `subscribe('*', cb, { expand })` als **drittes** Argument.
* Beim optimistischen Toggle auch `item.expand.done_by` lokal setzen (der eigene User
  steht im `authStore`), sonst springt der Name erst mit dem Realtime-Event nach.
* Optimistische Updates (Toggle, Delete) rollen bei einem Fehler den vorherigen Zustand
  zurück; der Fehler landet in `store.error`.

## PocketBase-Migrationen

* API-Stand **v0.23+**: `migrate((app) => { ... }, (app) => { ... })`, Collections über
  `new Collection({ ..., fields: [...] })` und `app.save(collection)`.
* Das **`id`-Feld explizit mitgeben** (`system: true, primaryKey: true`), nicht darauf
  hoffen, dass es automatisch entsteht.
* Relations brauchen eine `collectionId` — zur Laufzeit über
  `app.findCollectionByNameOrId('users').id` holen statt eine ID zu hardcoden.
* **`bool` kennt kein `default`.** "Nicht gesetzt" ist `false`, das genügt.
* Migrationen laufen bei *jedem* App-Bootstrap, also auch bei `superuser upsert`, nicht
  nur bei `serve`.

## PWA

* SvelteKit registriert `src/service-worker.js` im Production-Build automatisch — keine
  eigene Registrierung ins `app.html` schreiben.
* Der `fetch`-Handler muss existieren (sonst kein Install-Prompt in Chrome), darf aber
  trivial durchreichen. Kein Caching gewollt.
* `manifest.webmanifest` wird von PocketBase mit dem MIME-Typ des OS ausgeliefert
  (Windows: `text/plain`, Linux meist `application/manifest+json`). Chrome prüft den
  Manifest-MIME-Typ nicht — kein Handlungsbedarf.
* Icons neu bauen: `cd frontend && node scripts/generate-icons.mjs`.

## Beim Testen

* **Der eingebettete Browser-Pane blockiert Service-Worker-Registrierung** und lässt
  Klicks in 30s-Timeouts laufen. Das ist kein App-Bug. Für echte Verifikation den
  Playwright-MCP nehmen — dort registriert der SW sauber und Klicks funktionieren.
* **Umlaute in Bash-`curl`-Payloads werden auf Windows zerlegt** und PocketBase antwortet
  mit einem nichtssagenden `400`. Für Requests mit Umlauten (z.B. `category:"Obst/Gemüse"`)
  `node -e "fetch(...)"` benutzen, Token per Env-Variable übergeben.
* **Nach dem Löschen von `pb_data/` sieht die App eingeloggt aus, zeigt aber eine leere
  Liste.** Der Token im localStorage überlebt den DB-Reset, ist gegen die neue DB aber
  ungültig — jeder Request läuft in ein 401. Einmal abmelden, neu anmelden.
* Testdaten liegen in `pb/pb_data/` — zum Zurücksetzen einfach den Ordner löschen und
  den Superuser neu anlegen.

## Deployment (GitHub Actions -> STRATO-VPS)

* **`cp: cannot stat '<TARGET>/pb_data'` beim ersten Deploy.** `pb_data/` entsteht erst
  beim ersten PocketBase-Start, existiert auf einem frischen Server also nicht. Wenn das
  Backup-Kommando unter `set -e` daran scheitert, *nachdem* der Dienst gestoppt wurde,
  bleibt der Server gestoppt zurück. Deshalb: Sicherung nur `if [ -d ... ]`, und ein
  `trap '... systemctl start ...' EXIT` über den ganzen kritischen Abschnitt.
* **Der Deploy lädt hoch, aber nichts ändert sich.** Symptom: Workflow grün, App zeigt
  den alten Stand. Ursache: `TARGET` im Workflow ≠ `WorkingDirectory` der systemd-Unit —
  PocketBase sucht `pb_public/`, `pb_migrations/` und `pb_data/` relativ dazu. Prüfen mit
  `systemctl show pocketbase -p WorkingDirectory`.
* **`status=203/EXEC` heißt nicht, dass PocketBase abgestürzt ist.** Symptom: der
  Healthcheck läuft in zehn `curl: (7) Failed to connect`, `systemctl status` zeigt
  `Active: activating (auto-restart)` und `code=exited, status=203/EXEC`. Ursache: systemd
  konnte die Datei aus `ExecStart` gar nicht erst ausführen — sie fehlt, hat kein Exec-Bit
  oder ist der falsche Build (Windows-`.exe`, falsche Architektur). Von PocketBase selbst
  steht deshalb nichts im Log — der Prozess ist nie angelaufen; die Ursache loggt systemd
  selbst (`journalctl -u pocketbase`: `Failed to locate executable ...`, `Failed at step
  EXEC`). Das Binary wird bewusst *nicht*
  mitdeployt, es muss einmalig von Hand auf dem Server liegen. Prüfen mit
  `ls -l <TARGET>/pocketbase` und `file <TARGET>/pocketbase`.
* **„Noch keine Datenbank vorhanden" im Deploy-Log ist ein Warnsignal, kein Hinweis.**
  Nach dem ersten erfolgreichen Deploy darf die Zeile nicht mehr auftauchen. Tut sie es
  doch, schreibt der Deploy in ein Verzeichnis, in dem PocketBase noch nie gelaufen ist —
  also am Dienst vorbei oder auf einen Server ohne Installation.
* **`curl -fsS http://127.0.0.1/api/health` als Healthcheck taugt nicht.** Läuft
  PocketBase mit `--https`, antwortet Port 80 mit einem 301; `curl -f` wertet das als
  Erfolg, ohne die API je erreicht zu haben. `-L` folgt dem Redirect, `-k` akzeptiert das
  Domain-Zertifikat auf `127.0.0.1`.
* **`systemctl is-active` sagt bei `Type=simple` nichts aus.** Die Unit ist "active",
  sobald der Prozess geforkt ist — eine gescheiterte Migration sieht man daran nicht.
* **`set -e` bricht bei `[ "$(id -u)" -ne 0 ] && SUDO="sudo"` *nicht* ab**, auch wenn der
  Test fehlschlägt: errexit gilt nicht für Kommandos in einer `&&`-Liste außer dem
  letzten. Das Idiom ist also sicher.
* **Beim Umschwenken erst das Neue reinlegen, dann das Alte löschen.** `rm -rf pb_public
  && mv .deploy/pb_public pb_public` lässt bei einem gescheiterten `mv` einen laufenden
  Dienst ganz ohne Frontend zurück.

## Sonstiges

* `build.sh` löscht `pb/pb_public/` vor jedem Build; dort abgelegte Dateien (auch ein
  `.gitkeep`) überleben das nicht.
* Der Bash-Tool-Arbeitsordner bleibt zwischen Aufrufen bestehen — kein blindes
  `cd frontend && …` voranstellen.
* Lange Markdown-Dateien über das `Write`-Tool schreiben; als Bash-Heredoc brechen sie
  am Quoting.
* **`command not found` für ein Kommando, das es offensichtlich gibt** (`systemctl` auf
  einem systemd-Server). Erkennungszeichen ist die Escape-Sequenz in der Meldung selbst:
  `bash: $'\033[200~systemctl': command not found`, in der Terminalausgabe je nach Shell
  als `^[[200~`. Das ist der Bracketed-Paste-Marker, den das Terminal beim Einfügen
  mitschickt und den die Shell hier als Text übernommen hat statt als Steuerzeichen; der
  Befehl hieß also wörtlich `\033[200~systemctl`, hinten hängt der Schluss-Marker
  `\033[201~` dran (sichtbar `^[[201~`).
  Abstellen mit `bind 'set enable-bracketed-paste off'` oder die Zeile tippen statt
  einfügen.
* Bewusst *nicht* enthalten: mehrere Listen, Vorlagen, Statistiken, Offline-Caching.
  `quantity` und `note` existieren im Schema und werden angezeigt, haben aber noch kein
  Eingabefeld.
