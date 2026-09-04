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
│   ├── scripts/webpush.entry.js   # Quelle der Push-Krypto (RFC 8291 + 8292)
│   ├── scripts/build-webpush.mjs  # buendelt sie -> pb/pb_hooks/webpush.js
│   ├── scripts/webpush.test.mjs   # Selbsttest gegen den RFC-Testvektor
│   ├── static/                    # manifest.webmanifest + icon-32/192/512.png
│   └── src/
│       ├── app.html               # PWA-Metas
│       ├── app.css                # Tailwind-Entry: Design-Tokens hell/dunkel
│       ├── service-worker.js      # Pass-through-fetch + push/notificationclick
│       ├── lib/
│       │   ├── pocketbase.svelte.js  # PB-Client, authStore-Spiegel, Profil-Update
│       │   ├── items.svelte.js       # $state der Liste + Realtime
│       │   ├── push.svelte.js        # Abo an-/abmelden, Zustand der Erlaubnis
│       │   ├── utils.js              # cn() = clsx + tailwind-merge
│       │   ├── components/ui/        # shadcn-svelte, per CLI generiert (nicht haendisch pflegen)
│       │   └── Nav.svelte            # Topbar + Burgermenue (Sheet)
│       └── routes/                # +layout.js (ssr=false), +layout.svelte (Guard +
│                                  # Rahmen mit Nav), +page.svelte (Liste),
│                                  # profile/+page.svelte, residents/+page.svelte,
│                                  # login/+page.svelte
├── pb/
│   ├── pocketbase(.exe)           # gitignored, v0.23+ nötig (getestet: 0.40.2)
│   ├── pb_migrations/             # JS-Migrationen, laufen beim Start automatisch
│   ├── pb_hooks/
│   │   ├── push.pb.js             # Hook-Anmeldungen (Bootstrap, Routen, items)
│   │   ├── push-lib.js            # Schluessel, Empfaenger, Versand
│   │   └── webpush.js             # GENERIERT, nicht von Hand aendern
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
  `1756000002` öffnet die ViewRule für Eingeloggte. Die ListRule blieb dabei eng und
  öffnet erst `1756000004` — die Seite "Bewohner" braucht sie, denn mit der engen Rule
  liefert `getFullList('users')` nur den eigenen Datensatz. Damit ist `users` für
  Eingeloggte auflist- und filterbar; die Feldsichtbarkeit ändert das nicht (E-Mail
  weiter nur beim eigenen Record bzw. bei `emailVisibility`).
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
* **Eine Migration mit *kleinerer* Nummer nachschieben ist unkritisch.** PocketBase
  fuehrt Buch pro Datei (Tabelle `_migrations`), nicht ueber einen Hoechststand:
  `1756000004` lief auch dann noch an, als `1756000005` schon angewendet war
  (nachgemessen an einer DB mit dem alten Satz). Auf einer frischen DB ist die
  Reihenfolge ohnehin aufsteigend — nur wenn zwei Migrationen dasselbe Feld anfassen,
  muss man die Reihenfolge selbst durchdenken.

* **Ein Feld ändern statt anlegen: `fields.getByName(...)` liefert eine echte Referenz**,
  keine Kopie — mutieren und `app.save(collection)` genügt (verifiziert:
  `1756000003` setzt so die `thumbs` des `avatar`-Feldes). Der von PocketBase selbst
  generierte `fields.addAt(index, new Field({...}))`-Stil braucht dagegen die volle
  Feld-JSON inklusive `id` und die richtige Position.
* **Die Werte eines `select`-Feldes ändern heißt auch: Bestandsdaten umschreiben.**
  PocketBase prüft beim Speichern den *ganzen* Record, nicht nur die geschickten Felder —
  ein Item mit einem Wert, der nicht mehr in `values` steht, ließe sich also nicht mehr
  abhaken. Umschreiben geht in derselben Migration per
  `app.db().newQuery('UPDATE …').execute()` (so bei `1756000005`, alte Warengruppen ->
  `Supermarkt`).
* **`migrate up` sagt „No new migrations to apply", *nachdem* es die Migration ausgeführt
  hat.** Das Kommando bootstrappt die App, und der Bootstrap führt die offenen
  Migrationen selbst aus; die eigentliche Prüfung des Kommandos läuft danach und findet
  nichts mehr. Kein Grund zu suchen, warum `up` nichts tut — nachsehen, ob die Änderung
  schon da ist.
* **Ein `grep` in `pb_data/data.db` beweist nichts.** Frische Änderungen stehen im WAL
  (`data.db-wal`), nicht in der Hauptdatei — Symptom: die neuen Enum-Werte sind „nicht
  da", obwohl die Migration gelaufen ist. Zum Prüfen einen temporären Hook in `pb_hooks/`
  legen, der in `onBootstrap` über `$app` liest, und ihn hinterher löschen.
  (`$app.db().newQuery(...).all(arr, new DynamicModel(...))` lieferte dabei still nichts;
  `$app.findAllRecords('items')` funktioniert.)

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
  trivial durchreichen. Kein Caching gewollt. Die Handler für `push` und
  `notificationclick` stehen in derselben Datei — siehe
  [Web Push](#web-push-benachrichtigungen).
* **Im Dev-Modus registriert SvelteKit den Worker nicht**, und `navigator.serviceWorker.ready`
  wartet dann *für immer*, statt zu scheitern. `push.svelte.js` registriert ihn deshalb
  unter `dev` selbst (`register('/service-worker.js', { type: 'module' })`) — im
  Produktionsbuild ist derselbe Aufruf ein No-op, weil Scope und URL schon belegt sind.
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

## Web Push (Benachrichtigungen)

Ein neuer Eintrag auf dem Zettel löst eine Push-Benachrichtigung an alle *anderen*
Familienmitglieder aus. Verschickt wird serverseitig aus einem PocketBase-Hook, ganz
ohne fremden Dienst: Web Push nach **RFC 8291** (Nutzlast als `aes128gcm`) und
**RFC 8292** (VAPID/ES256). Empfänger sind die Push-Dienste der Browser (FCM, Mozilla
Autopush, Apple).

* Collection **`push_subscriptions`**: ein Datensatz pro Gerät (`endpoint` mit
  Unique-Index, `p256dh`, `auth`, `device`). Alle Rules auf `user = @request.auth.id` —
  jeder verwaltet nur die eigenen Abos, auch beim Anlegen.
* Collection **`push_config`**: genau ein Record `vapid` mit dem Schlüsselpaar des
  Servers, beim ersten Start selbst erzeugt. **Ohne API-Rules** (`null` = nur
  Superuser); der öffentliche Teil kommt über `GET /api/push/key` heraus. Der private
  Schlüssel liegt im Klartext in `pb_data` — bewusst, dort stehen auch die
  Passwort-Hashes.
* Das Schlüsselpaar muss **stabil bleiben**: die Abos der Browser hängen daran. Ein
  neues Paar (z.B. nach `rm -rf pb_data`) macht jedes vorhandene Abo ungültig; der
  Push-Dienst antwortet dann mit 403. `refreshPush()` merkt das beim Laden der
  Profilseite (Vergleich mit `subscription.options.applicationServerKey`) und meldet
  das Gerät ab, statt „eingeschaltet“ anzuzeigen und still nichts mehr zu liefern.
* `POST /api/push/test` schickt eine Probe an die *eigenen* Geräte. Ohne so einen Knopf
  lässt sich die Kette Browser → Push-Dienst → Gerät mit nur einem Gerät nicht prüfen.
* Ein abgelaufenes Abo (404/410 vom Dienst) wird serverseitig gelöscht — die Tabelle
  räumt sich selbst auf, wenn jemand die App deinstalliert.
* **Abmelden muss das Abo mitnehmen.** `logout()` ruft vorher
  `unsubscribeThisDevice()`; danach fehlt das Token dafür. Ohne das zeigt ein
  abgemeldetes Gerät weiter jede neue Zeile der Liste an — Abo und Datensatz bleiben ja
  gültig. Der Import ist dynamisch, sonst gäbe es einen Zyklus
  (`push.svelte.js` braucht `pb`).
* Bekannte Grenze: **auf dem iPhone gibt es Web Push nur in der installierten PWA**
  (iOS 16.4+). In Safari als Tab fehlt `PushManager` einfach — kein Fehler, kein
  Hinweis. Die Profilseite sagt das darum von sich aus, wenn `supported` false ist und
  der User-Agent nach iOS aussieht.
* Nach `npm run test:hooks` läuft der Selbsttest der Krypto gegen den Testvektor aus
  RFC 8291 §5 — der prüft die Verschlüsselung bytegenau.

### Fallstricke der PocketBase-JS-VM (alle hier real aufgetreten)

* **Ein Hook-Callback sieht den Modulscope seiner Datei nicht.** PocketBase führt jeden
  Callback in einer eigenen JS-VM aus. Eine Funktion neben dem Hook zu definieren und
  darin aufzurufen endet in `ReferenceError: <name> is not defined` — und zwar erst zur
  Laufzeit, beim Bootstrap als stiller Log-Eintrag, bei einer Route als nacktes `400`.
  Alles Gemeinsame muss in ein Modul, das **innerhalb** des Callbacks geladen wird
  (`require(`${__hooks}/push-lib.js`)`). Deshalb die Trennung push.pb.js / push-lib.js.
* **`require()` löst `node_modules` nicht auf**, nur relative Pfade: ein Paket dort
  abzulegen bringt `GoError: Invalid module`. Deshalb wird die Krypto zu *einer* Datei
  gebündelt (`frontend/scripts/build-webpush.mjs` → `pb/pb_hooks/webpush.js`, im Repo,
  damit der Server kein npm braucht).
* **Binäre Daten gehen nur als `Uint8Array` durch `$http.send`.** Ein „Binärstring“
  wird beim Übergang nach Go als UTF-8 kodiert — nachgemessen: 6 Bytes
  (`00 41 80 ff c3 28`) kommen als 9 an (`0041c280c3bfc38328`). Ein `ArrayBuffer` kommt
  als **leerer** Body an, ohne Fehler. Ein verschlüsselter Push-Body ist damit stiller
  Datenmüll.
* **Die JS-VM hat keine WebCrypto** (`crypto` und `TextEncoder` sind `undefined`), also
  reine JS-Krypto. Zufall kommt aus `$security.randomString` (crypto/rand, aber nur
  alphanumerisch) und wird per SHA-256 zu gleichverteilten Bytes — der Polyfill steht im
  Banner des Bundles.
* **Kein `setTimeout`, keine Goroutine.** Der Versand läuft deshalb synchron im Request
  des Anlegenden mit. Gemessen: ein `create` mit drei Empfängern dauert 260–470 ms statt
  ~40 ms. Für eine Familienliste in Ordnung; wer hundert Empfänger hat, braucht einen
  anderen Weg.
* **`$security.sha256` & Co. taugen nicht für beliebige Bytes** — dieselbe
  UTF-8-Falle wie oben. Für ASCII (z.B. das Ergebnis von `randomString`) sind sie in
  Ordnung.
* **`app.logger()` schreibt nicht nach stdout**, sondern in die `_logs`-Collection.
  Ansehen mit `GET /api/logs?perPage=20&sort=-created` als Superuser; die Zeilen
  erscheinen mit ein paar Sekunden Verzögerung (PocketBase schreibt gebündelt).
* **`res.body` einer `$http.send`-Antwort ist ein Byte-Array.** Im Log steht dann
  `"112,101,114,109,..."` statt Text. Vor dem Loggen dekodieren, sonst ist die
  Fehlermeldung des Push-Dienstes unlesbar — und genau die sagt, was los ist.
* **Änderungen in `pb_hooks/` wirken erst nach einem Neustart.** PocketBase schreibt nur
  `File ... changed, please restart the app manually` und läuft mit dem alten Code
  weiter. Zwei Stunden Fehlersuche wert.

### Signatur: `@noble/curves` v2 hasht selbst

**Symptom:** FCM antwortet `403 permission denied: invalid JWT provided`. Uhr stimmt,
`aud` stimmt, `exp` liegt innerhalb von 24 h, `sub` ist eine gültige `https:`- bzw.
`mailto:`-Adresse — und `p256.verify()` bestätigt die eigene Signatur als gültig.

**Ursache:** In `@noble/curves` v2 ist `prehash` in `sign()` **standardmäßig an**. Wer
`p256.sign(sha256(msg), key)` schreibt, hasht zweimal; die Signatur ist damit nicht
ES256-konform. `p256.verify(sig, sha256(msg), pub)` macht denselben Fehler ein zweites
Mal und bestätigt sie — der Test ist also mit sich selbst einig und mit niemandem sonst.
Richtig ist `p256.sign(msg, key)` (oder `{ prehash: false }` mit dem Hash).

**Lehre fürs nächste Mal:** eine Signatur *nie* mit der Bibliothek prüfen, die sie
erzeugt hat. `frontend/scripts/webpush.test.mjs` prüft sie darum mit Node WebCrypto —
das ist die Zeile, die den Fehler gefunden hat.

## Beim Testen

* **Weiße Seite mit genau einem `TypeError: Cannot read properties of undefined
  (reading 'data')`.** Kein Svelte-Fehler, sondern ein zerrissener Build in
  `pb/pb_public/`: SvelteKit legt seinen Laufzeit-Zustand unter einem pro Build neu
  gewürfelten Global `__sveltekit_<hash>` ab, das `index.html` inline setzt und die
  Chunks lesen. Laufen zwei Builds ineinander (hier: zwei Sessions parallel), passt das
  `index.html` des einen nicht zu den Chunks des anderen und die Hydration stirbt an
  der ersten Zeile. Prüfen statt raten:
  `grep -ro "__sveltekit_[a-z0-9]*" pb/pb_public | sed 's/.*://' | sort -u` muss
  **genau einen** Namen ausgeben. Heilmittel ist ein erneutes `build.sh`.

* **Der eingebettete Browser-Pane blockiert Service-Worker-Registrierung** und lässt
  Klicks in 30s-Timeouts laufen. Das ist kein App-Bug. Für echte Verifikation den
  Playwright-MCP nehmen — dort registriert der SW sauber und Klicks funktionieren.
* **Der Playwright-MCP lädt nur Dateien aus dem Projektordner hoch.** Symptom:
  `File access denied: … is outside allowed roots`. Testbilder also nicht im Temp-Ordner
  ablegen, sondern im Repo (und hinterher wegräumen).
* **Der Playwright-MCP-Browser kann von einer *parallelen* Session belegt sein:**
  `Browser is already in use for …, use --isolated`. Ausweg ohne Warten: Chromium selbst
  starten und per CDP fahren — die Playwright-Binary liegt unter
  `%LOCALAPPDATA%\ms-playwright\chromium-*/chrome-win64/chrome.exe`, Node ≥ 22 hat ein
  globales `WebSocket`, mehr braucht es nicht (`--remote-debugging-port`, dann
  `/json/list` und `Target.attachToTarget`).
  Drei Fallen dabei:
  * **Ohne `--no-sandbox` stirbt der Netzwerkdienst dieses Builds beim Start**
    („Sandbox cannot access executable … Access is denied", dann „Network service
    crashed"). Die Seite ist danach ein Fehlerdokument mit *korrekter* URL — `fetch`
    schlägt fehl und `navigator.serviceWorker` ist `undefined`, was wie ein
    App-Problem aussieht.
  * **Ziel über `/json/list` suchen, nicht über `Target.getTargets`.** Chromium führt
    neben dem Tab eigene WebUI-Seiten als Ziel; hängt man an der falschen, gilt
    dasselbe Symptom wie oben. `/json/list` liefert die URL mit.
  * **`ServiceWorker.deliverPushMessage` braucht die Page-Session** (`sessionId`), nicht
    die Browser-Session — sonst `'ServiceWorker.deliverPushMessage' wasn't found`. Damit
    lässt sich der `push`-Handler ohne echten Push-Dienst auslösen.
* **Headless-Chromium bekommt echte FCM-Abos** (`fcm.googleapis.com/preprod/wp/…`), aber
  das erste `subscribe()` dauert bis zu 30 s, und die Zustellung klappt nicht immer.
  Kommt keine Meldung an, erst ins `_logs` schauen: steht dort kein „Push abgelehnt",
  hat der Dienst die Nachricht angenommen und es ist ein Headless-Effekt.
* **Ein mit `(cmd &)` in den Hintergrund geschickter Server überlebt den Bash-Aufruf
  nicht.** Symptom: Minuten später schlagen alle Requests fehl, und im Browser sieht man
  genau die Symptome des `--no-sandbox`-Falls oben (kein `fetch`, kein Service Worker) —
  weil die Seite nur eine Fehlerseite ist. PocketBase für Tests deshalb über das
  `run_in_background` des Bash-Tools starten und mit `/api/health` prüfen, *bevor* man
  einem Browserergebnis glaubt.
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
