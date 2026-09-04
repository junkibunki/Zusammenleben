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
│   ├── vite.config.js             # Tailwind-Plugin + Dev-Proxy /api + /_ -> :8090
│   ├── components.json            # shadcn-svelte-Config (Style vega, Basis neutral)
│   ├── scripts/generate-icons.mjs # skaliert icon-source.png -> static/ (node:zlib)
│   ├── scripts/icon-source.png    # Bildquelle, absichtlich nicht in static/
│   ├── static/                    # manifest.webmanifest + icon-32/192/512.png
│   └── src/
│       ├── app.html               # PWA-Metas
│       ├── app.css                # Tailwind-Entry: Design-Tokens hell/dunkel
│       ├── service-worker.js      # trivialer Pass-through, SvelteKit registriert ihn selbst
│       ├── lib/
│       │   ├── pocketbase.svelte.js  # PB-Client, authStore-Spiegel, Profil-Update
│       │   ├── items.svelte.js       # $state der Liste + Realtime
│       │   ├── utils.js              # cn() = clsx + tailwind-merge
│       │   ├── components/ui/        # shadcn-svelte, per CLI generiert (nicht haendisch pflegen)
│       │   └── Nav.svelte            # Topbar + Burgermenue (Sheet)
│       └── routes/                # +layout.js (ssr=false), +layout.svelte (Guard +
│                                  # Rahmen mit Nav), +page.svelte (Liste),
│                                  # profile/+page.svelte, login/+page.svelte
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
* Ein `bind:this`, das in einem `$effect` gelesen wird, braucht `$state` — sonst warnt
  `svelte-check` mit `non_reactive_update` und der Effekt läuft nie (Fokus in die
  Menü-Schublade, `Nav.svelte`).
* **Was ein `$effect` liest, darf sein eigener Ablauf nicht schreiben.** Real passiert und
  teuer: `syncItems()` läuft aus dem `$effect` der Listenseite und entschied den
  Ladehinweis mit `store.loading = store.items.length === 0`. Damit hing der Effekt an
  `store.items` — genau dem, was sein `getFullList().then()` neu zuweist. Ergebnis: eine
  Endlosschleife aus Laden, Neustart, Ab- und wieder Anmelden des Realtime-Kanals,
  gemessen **über 100 Requests in 1,2 Sekunden** ohne jede Bedienung.
  Zwei Dinge daran sind bemerkenswert: es fällt nicht auf (die Liste sieht richtig aus,
  `svelte-check` ist still, der Build ist grün — nur der Netzwerk-Tab schreit), und es
  frisst nebenbei jede Meldung in `store.error` auf, weil jede Runde sie zurücksetzt.
  Ein Zustand, der nur *steuert*, wie geladen wird, gehört deshalb in eine gewöhnliche
  Modulvariable (`let loadedOnce = false` in `items.svelte.js`), nicht in `$state`.
  Beim Ändern eines `$effect` immer fragen: liest das hier etwas, das der eigene
  Rückweg schreibt? Und danach die Requests zählen, nicht nur die Anzeige ansehen.
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
  nur bei `serve`. Deshalb darf eine Migration **nicht werfen, wenn das Erwartete fehlt** —
  ein `users.fields.getByName('x').y = …` auf ein nicht vorhandenes Feld nimmt die ganze
  App mit runter, statt nur die Migration. Erst holen, prüfen, dann setzen.
* **Ein Feld ändern statt anlegen: `fields.getByName(...)` liefert eine echte Referenz**,
  keine Kopie — mutieren und `app.save(collection)` genügt (verifiziert:
  `1756000003` setzt so die `thumbs` des `avatar`-Feldes). Der von PocketBase selbst
  generierte `fields.addAt(index, new Field({...}))`-Stil braucht dagegen die volle
  Feld-JSON inklusive `id` und die richtige Position.

## Profil / Dateiupload

* **`?thumb=WxH` funktioniert nur für Größen, die im Feld unter `thumbs` stehen.** Symptom:
  die URL liefert 200 und ein gültiges Bild — nur eben das Original in voller Größe. Kein
  Fehler, kein Log. PocketBase fällt bei einer nicht registrierten Größe still zurück
  (nachgemessen: `?thumb=200x200` → 5,6 KB, `?thumb=33x33` → 7,9 KB = Originaldatei).
  Deshalb Migration `1756000003`; `avatarUrl()` in `pocketbase.svelte.js` muss dieselbe
  Größe verwenden.
* **Upload per `FormData`**, nicht als JSON-Objekt; `data.append('avatar', '')` löscht die
  Datei.
* **Handyfotos vor dem Upload verkleinern.** Das `avatar`-Feld hat `maxSize: 0`, das ist
  PocketBase-Default = 5 MB; ein Foto darüber wird abgelehnt. `profile/+page.svelte`
  skaliert per Canvas auf 512px (5,8-MB-PNG → 7,9-KB-JPEG).
  Dabei zwei Fallen: **JPEG kennt kein Alpha**, also vor `drawImage` weiß füllen, sonst
  wird jede transparente Fläche schwarz — und **ist das Bild schon klein genug, gar nicht
  neu codieren**, sonst verliert ein PNG-Logo seine Transparenz ohne jeden Grund.
* **PocketBase sagt bei einem abgelehnten Upload nur "Failed to update record."** Der echte
  Grund (falscher MIME-Typ, zu groß) steht in `err.response.data.<feld>.message`. Ohne
  Auswertung sieht der Nutzer einen englischen Satz ohne Information.
* Das `avatar`-Feld ist `protected: false`: die Datei-URL ist **ohne Token abrufbar**,
  geschützt nur durch den zufälligen Dateinamen. Bewusst so — für eine Familienliste
  reicht das, und Bilder liegen so im Browser-Cache. Wer das enger will: `protected: true`
  plus `pb.files.getToken()`.
* Bekannte Grenze: eine Namensänderung wirkt **nicht** auf bereits geladene Listenzeilen —
  die zeigen `item.expand.added_by.name` aus dem Cache. Beim nächsten Betreten der Liste
  (`syncItems()` lädt neu) steht der neue Name da.

## Designsystem: Tailwind v4 + shadcn-svelte

Alle UI-Bausteine kommen aus **shadcn-svelte** (Style `vega`, Basisfarbe `neutral`), das
Layout aus Tailwind-Utilities. Es gibt keine handgeschriebenen Komponenten-Styles mehr.

* **`shadcn` und `shadcn-svelte` sind zwei Projekte.** `shadcn/ui` ist React-only; für
  Svelte gilt `shadcn-svelte` (eigene CLI, eigene Registry, Unterbau `bits-ui`).
* **Komponenten nicht von Hand pflegen.** `src/lib/components/ui/**` ist CLI-Output.
  Nachziehen mit `npx shadcn-svelte add <name>` (`-o` überschreibt). Eigene Anpassungen
  gehören in die aufrufende Seite, nicht in die generierte Datei.
* **`shadcn-svelte init` läuft nicht ohne TTY durch.** Symptom: `--preset default` (oder
  jeder Name aus der Liste) wird mit „is not a valid preset" abgelehnt, danach fragt die
  CLI interaktiv und hängt. `--preset` erwartet keinen Namen, sondern den Code von
  `shadcn-svelte.com/create`. Ausweg: `components.json` selbst schreiben — `add` braucht
  nur diese Datei und kennt `-y`. Die Registry liegt unter
  `https://shadcn-svelte.com/registry/styles/<style>/<komponente>.json`, die Farb-Tokens
  unter `…/registry/colors/<basisfarbe>.json` (daraus ist `app.css` erzeugt).
* **Kein `tailwind.config.js` mehr.** Tailwind v4 konfiguriert sich in `app.css`:
  `@import 'tailwindcss'`, Tokens als CSS-Variablen, `@theme inline` bildet sie auf
  Utility-Namen ab (`--color-card` → `bg-card`), `@utility` definiert eigene (hier
  `safe-t` / `safe-b` für die iPhone-Safe-Areas).
* **Dark Mode über `prefers-color-scheme` braucht eine eigene `@custom-variant`.** Die
  shadcn-Vorgabe ist `@custom-variant dark (&:is(.dark *))`, also ein Klassenschalter.
  Ohne Umstellung auf `@custom-variant dark (@media (prefers-color-scheme: dark))` greifen
  die `dark:`-Utilities *in den generierten Komponenten* nie — die Tokens schalten, die
  Feinheiten (z.B. `dark:bg-input/30`) nicht. Symptom: dunkel sieht fast richtig aus,
  einzelne Flächen bleiben hell.
* **Ein `<form>` um `Card.Header`/`Content`/`Footer` frisst die Abstände.** `Card.Root`
  ist `flex flex-col gap-(--card-spacing)`; die Abschnitte haben selbst nur waagerechtes
  Padding. Sitzt ein Wrapper dazwischen, klebt der Inhalt aneinander (Symptom: Label
  direkt unter der Description). Der Wrapper muss die Rhythmik übernehmen:
  `<form class="flex flex-col gap-(--card-spacing)">`.
* **Die `Checkbox` von bits-ui ist ein `<button role="checkbox">`.** Ein verstecktes
  `<input type="checkbox">` rendert sie nur, wenn `name` gesetzt ist. Ein `<label>` drumherum
  schaltet sie also nicht zuverlässig (und kann bei einem gelabelten Button doppelt
  auslösen). Deshalb in der Liste: Checkbox trägt den zugänglichen Namen
  (`aria-label={item.name}`), der antippbare Rest der Zeile ist ein eigener Button mit
  `tabindex="-1"` und `aria-hidden` — ein Bedienelement für Screenreader, zwei
  Trefferflächen für den Daumen.
* **Für einen Datei-Dialog reicht ein Button.** `<input type="file" class="hidden">` plus
  `onclick={() => input?.click()}` am shadcn-`Button`: die Tastatur bedient den Button,
  das Feld selbst bleibt aus der Tab-Reihenfolge. Das löst denselben Fall wie früher der
  fokussierbare 1px-Input, mit weniger CSS.
* **Tap-Targets kommen nicht von allein, auch nicht mit `size="lg"`.** shadcn ist für die
  Maus gebaut: `default` = `h-9` (36px), `lg` = `h-10` (**40px**), `icon` = `size-9`,
  `sm` = `h-8` (32px). Für die 44px, die diese App vorher über `--tap` hatte, muss die
  Höhe explizit dazu: `class="h-11"` bzw. `class="size-11"` bei Icon-Buttons. Nachmessen
  statt schätzen — `size="lg"` sieht nach „groß" aus und ist es nicht.
* **Eine Variante schlägt die nackte Utility-Klasse, und `tailwind-merge` merkt es nicht.**
  Symptom: `<Select.Trigger class="h-11">` bleibt 36px hoch. Ursache: der Trigger bringt
  `data-[size=default]:h-9` mit; kompiliert ist das
  `.data-\[size\=default\]\:h-9[data-size=default]` (Spezifität 0,2,0) und gewinnt gegen
  `.h-11` (0,1,0). `tailwind-merge` kann nicht entwirren, weil Variante und nackte Klasse
  für es verschiedene Gruppen sind. Also **über dieselbe Variante** setzen:
  `class="h-11 data-[size=default]:h-11"`. Genauso ist `w-72` an `Sheet.Content` wirkungslos
  (`data-[side=left]:w-3/4` gewinnt) — solche Klassen sehen aus wie Code und sind keiner.
* **Die Höhe der Topbar steht als `--header-h` in `app.css`.** Die Eingabeleiste der Liste
  klebt mit `sticky top-(--header-h)` darunter. Ein hart notiertes `top-14` ist falsch,
  sobald `env(safe-area-inset-top)` nicht 0 ist: in der installierten iOS-PWA wandert der
  Header nach unten, die Leiste bleibt oben und verschwindet beim Scrollen dahinter.
  Nachgemessen mit simuliertem 47px-Inset: Header 104px, Leiste bei 104px.
* **`theme-color` zweimal setzen**, je `prefers-color-scheme` — sonst bleibt die
  Browserleiste hell, während die App fast schwarz ist. Manifest und Icon-Skript kennen
  weder `oklch` noch Variablen, dort stehen die Tokens als Hex (`#ffffff`, `#0a0a0a`,
  Icon-Hintergrund `#171717`).
* **`--chart-*` und `--sidebar-*` sind bewusst aus `app.css` entfernt** (nichts nutzt sie,
  und die Sidebar-Akzente sind im Dunkelmodus blau — das widerspricht „neutral"). Wer per
  `add` eine Chart- oder Sidebar-Komponente holt, muss die Tokens aus
  `…/registry/colors/neutral.json` wieder eintragen.
* Der `vega`-Preset nennt Inter als Schrift; das ist hier **nicht** eingebunden.
  Tailwinds eigenes `--font-sans` ist bereits ein System-Stack
  (`-apple-system, BlinkMacSystemFont, 'Segoe UI', …`) — kein Webfont, kein
  Fremd-Request, dieselbe Optik wie vor dem Umbau.

## PWA

* SvelteKit registriert `src/service-worker.js` im Production-Build automatisch — keine
  eigene Registrierung ins `app.html` schreiben.
* Der `fetch`-Handler muss existieren (sonst kein Install-Prompt in Chrome), darf aber
  trivial durchreichen. Kein Caching gewollt.
* `manifest.webmanifest` wird von PocketBase mit dem MIME-Typ des OS ausgeliefert
  (Windows: `text/plain`, Linux meist `application/manifest+json`). Chrome prüft den
  Manifest-MIME-Typ nicht — kein Handlungsbedarf.
* Icons neu bauen: `cd frontend && node scripts/generate-icons.mjs`. Quelle ist
  `frontend/scripts/icon-source.png`, Ausgabe sind `icon-32/192/512.png` in `static/`.

### Icons aus einem Bild erzeugen

* **Auf diesem Rechner gibt es kein Bildwerkzeug** — und das ist doppelt getarnt:
  `command -v convert` findet `/c/Windows/system32/convert`, das ist das
  *Dateisystem*-Konvertierprogramm von Windows, nicht ImageMagick. `python`/`python3`
  liegen in `WindowsApps` und sind bloß Store-Platzhalter: sie drucken „Python wurde
  nicht gefunden" und enden mit **Exit 49**, obwohl `command -v` sie findet. `magick`
  und `ffmpeg` fehlen ganz. Skalieren also in Node mit `node:zlib` — für 8-Bit-RGB(A)
  ohne Interlacing sind Dekoder und Enkoder je ~40 Zeilen.
* **Ein Foto ohne Zeilenfilter zu kodieren kostet die Hälfte.** Der alte Generator schrieb
  Filter 0 für jede Zeile — bei den einfarbigen Platzhalter-Icons egal, bei einem Bild
  nicht: gemessen 645 KB gegen 439 KB für dasselbe 512er. Dazu `colorType 2` statt `6`,
  wenn kein Pixel transparent ist. Die Filterwahl nach der Heuristik der PNG-Spec (12.8,
  kleinste Summe der Absolutwerte) genügt.
* **Beim Verkleinern Flächenmittel nehmen, nicht das nächste Pixel.** 1254 → 192 heißt,
  dass jedes Zielpixel ~43 Quellpixel überdeckt; ein naives Sampling wirft 42 davon weg
  und lässt feine Strukturen (Baumkronen, Wasserspiegelungen) flimmern.
* **Die Bildquelle darf nicht in `static/`.** Sonst liefert PocketBase sie unter
  `/icon.png` in Originalgröße aus und `build.sh` kopiert sie in jeden Build (hier
  2,4 MB). Sie gehört neben das Skript, das sie liest.
* **Ein randloses Bild braucht kein eigenes maskable-Icon.** Android beschneidet auf die
  Safe-Zone (Kreis mit 80 % der Kante) — bei einem Foto trifft das nur den Rand, also
  `"purpose": "any maskable"` am 512er und eine Datei weniger. Aufpolstern wäre hier das
  schlechtere Ergebnis: es erzeugt Balken in einer Volltonfarbe, die im Bild nicht
  vorkommt. Nachsehen statt raten — die Maske einmal als Kreis über das Icon rendern.
* **Der Favicon-Link zeigt leicht auf ein Riesenbild.** `rel="icon"` hing an
  `icon-192.png`; als Volltongrafik waren das 923 Bytes, als Foto 72 KB — auf jedem
  Seitenaufruf. Deshalb `icon-32.png` fürs Tab.
* Prüfen, ob die Icons wirklich taugen, geht ohne Screenshot: im Browser über
  `fetch` + `createImageBitmap` die Größe jedes Manifest-Icons messen und gegen das
  `sizes`-Attribut halten. Das beweist nebenbei, dass ein *fremder* Dekoder die selbst
  geschriebenen PNGs liest.

## Beim Testen

* **Der eingebettete Browser-Pane blockiert Service-Worker-Registrierung** und lässt
  Klicks in 30s-Timeouts laufen. Das ist kein App-Bug. Für echte Verifikation den
  Playwright-MCP nehmen — dort registriert der SW sauber und Klicks funktionieren.
* **Der Playwright-MCP lädt nur Dateien aus dem Projektordner hoch.** Symptom:
  `File access denied: … is outside allowed roots`. Testbilder also nicht im Temp-Ordner
  ablegen, sondern im Repo (und hinterher wegräumen).
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
  Healthcheck läuft in lauter `curl: (7) Failed to connect`, `systemctl status` zeigt
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
  PocketBase mit `--https`, antwortet Port 80 mit einem 302; `curl -f` wertet das als
  Erfolg, ohne die API je erreicht zu haben.
* **`-L` reicht nicht, und `-k` hilft nicht.** Symptom: der Healthcheck läuft in lauter
  `curl: (35) TLS connect error: error:0A000438:SSL routines::tlsv1 alert internal error`,
  während `systemctl status` `active (running)` zeigt und die Seite von außen
  einwandfrei antwortet. Ursache: PocketBase leitet unter Beibehaltung des Host-Headers
  um, aus `http://127.0.0.1/api/health` wird also `https://127.0.0.1/api/health`. Zu
  einer IP-Adresse schickt curl keine SNI, und ohne Servernamen findet PocketBases
  Autocert kein Zertifikat und bricht den Handshake mit einem fatalen Alert ab. Das
  passiert **serverseitig, vor jeder Zertifikatsprüfung** — deshalb ändert `-k` nichts.
  Nachstellen von außen: `curl -k https://<IP>/api/health` schlägt genauso fehl,
  `https://<domain>/api/health` nicht. Lösung: die Domain anfragen und die Verbindung
  per `--resolve "$DOMAIN:443:127.0.0.1"` auf Loopback zwingen — richtige SNI, gültiges
  Zertifikat, kein Umweg über DNS. `-k` bleibt trotzdem stehen — geprüft werden soll,
  ob die API antwortet, nicht ob die Kette auf genau diesem Server verifizierbar ist.
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
