# CLAUDE.md — Einkaufsliste

Notizen für zukünftige Sessions. Ergänzt das [README](README.md) (das erklärt Setup und
Deploy für Menschen); hier steht, was beim Arbeiten am Code stolpert.

## Workflow

### Review vor jedem Commit

* **Vor dem Committen muss ein unabhängiger Subagent ohne Vorwissen das Entwickelte
  reviewen.**
* Der Agent bekommt **nur eine kurze Einleitung zur Anforderung an das Feature** — nicht,
  was umgesetzt wurde, nicht welche Dateien betroffen sind, keine Begründungen. Er soll
  unvoreingenommen gegen die Anforderung prüfen, nicht die eigene Erzählung bestätigen.
* Er soll keine UI-Tests durchführen. Reine UI-Änderungen kann der Nutzer selbst testen,
  das spart Token.
* **Nur committen, wenn der Agent grünes Licht gibt.** Bei Findings: erst beheben.

**Nach dem Beheben ist ein zweites Review nicht automatisch fällig** — entscheide nach dem
Umfang der Korrektur, nicht nach der Zahl der Findings:

* **Klein → direkt committen.** Die Korrektur blieb im schon geprüften Code, hat keinen
  neuen Ablaufpfad geschaffen und nichts angefasst, was außerhalb liegt: eine
  Bedingung gedreht, einen Fehlerfall ergänzt, umbenannt, Text- und Layoutkram, eine
  vergessene `expand`-Option.
* **Groß → erneut reviewen.** Sobald die Korrektur eine neue Ablauflogik einführt, weitere
  Dateien mitzieht, Schema/Migration/API-Rules berührt, an Auth oder dem Push-Versand
  dreht, oder wenn du beim Beheben gemerkt hast, dass der Ansatz selbst nicht stimmte.
  Dann sieht der zweite Agent faktisch neuen Code — der war noch nie geprüft.
* Im Zweifel reviewen. Ein zweiter Durchlauf kostet weniger als ein Fehler, der über
  `main` auf den VPS geht.

### Pitfalls dokumentieren

**Wann.** Wenn dich bei der Entwicklung etwas Zeit gekostet hat, weil es nicht
offensichtlich war: eine Fehlermeldung, die in die Irre führt, eine API, die sich anders
verhält als erwartet, ein Tool-/Umgebungsproblem, das wie ein Bug im Code aussieht.
Kein Pitfall ist: was der Code oder die git-History ohnehin schon zeigt.

**Wohin.** In dieser Reihenfolge prüfen:

1. Gehört er zu einem Thema der Tabelle unten → in *diese* Datei, in den passenden
   Abschnitt. Nicht ans Ende hängen.
2. Betrifft er Svelte-Runes oder das PocketBase-SDK/Realtime → in die entsprechende Liste
   hier in CLAUDE.md. Das sind die einzigen zwei Themen, die dauerhaft im Kontext bleiben.
3. Sonst: **neue Datei unter `docs/pitfalls/`**, benannt nach dem Thema, mit einer
   Kopfzeile „Lesen, bevor du …" — und **eine neue Zeile in der Tabelle unten**. Ohne den
   Tabelleneintrag findet die Datei nie jemand.

Ein neues Thema anzulegen ist der Normalfall, nicht die Ausnahme: lieber eine sechste
kurze Datei als ein siebter Absatz in einer fremden.

**Wie.** Kurz, im Stil der vorhandenen Einträge:

* **Symptom zuerst** (die Fehlermeldung oder das beobachtete Verhalten wörtlich), dann
  **Ursache**, dann die Lösung. Beim nächsten Mal erkennt man den Fall am Symptom wieder —
  deshalb steht es vorn.
* **Ein Absatz oder ein Listenpunkt, Richtwert 3–8 Zeilen.** Kein Verlaufsprotokoll der
  Fehlersuche, keine Begründung, warum man erst woanders gesucht hat.
* Messwerte nur, wenn sie das Erkennen tragen (`?thumb=200x200` → 5,6 KB vs. 7,9 KB), nicht
  als Beleg dafür, dass gemessen wurde.
* Wird ein Abschnitt beim Ergänzen länger als ~80 Zeilen, teile ihn auf, statt ihn wachsen
  zu lassen. Diese Datei soll unter ~200 Zeilen bleiben (Stand jetzt: 213 — der nächste
  Zuwachs geht nicht mehr hier hinein, sondern in eine Datei unter `docs/pitfalls/`).

## Vertiefung: erst lesen, wenn das Thema dran ist

Diese Dateien sind bewusst *nicht* in diese Datei eingebunden (auch nicht per `@import`),
damit sie nur Kontext kosten, wenn sie gebraucht werden.

| Datei | Lesen, bevor du … |
|---|---|
| [migrationen.md](docs/pitfalls/migrationen.md) | eine Migration in `pb/pb_migrations/` anlegst oder änderst |
| [designsystem.md](docs/pitfalls/designsystem.md) | an UI-Komponenten, `app.css` oder Layout arbeitest |
| [pwa-und-push.md](docs/pitfalls/pwa-und-push.md) | Service Worker, `push.svelte.js` oder `pb/pb_hooks/` anfasst |
| [pocketbase-hooks.md](docs/pitfalls/pocketbase-hooks.md) | einen Request-Hook schreibst, der Felder setzt oder Fehler wirft |
| [profil-upload.md](docs/pitfalls/profil-upload.md) | am Avatar oder einem anderen Dateifeld arbeitest |
| [testen.md](docs/pitfalls/testen.md) | die App lokal startest oder im Browser verifizierst |
| [deployment.md](docs/pitfalls/deployment.md) | `deploy.yml` änderst oder einem grünen Deploy glaubst |
| [mandanten.md](docs/pitfalls/mandanten.md) | eine Rule auf `memberships` schreibst oder eine Collection pro Haushalt anlegst |

## Struktur

```
/
├── frontend/                      # SvelteKit, Svelte 5 Runes, SPA
│   ├── svelte.config.js           # adapter-static, Output -> ../pb/pb_public
│   ├── vite.config.js             # Tailwind-Plugin + Dev-Proxy /api + /_ -> :8090
│   ├── components.json            # shadcn-svelte-Config (Style vega, Basis neutral)
│   ├── scripts/                   # generate-icons.mjs (icon-source.png -> static/),
│   │                              # webpush.entry.js + build-webpush.mjs (-> pb_hooks/
│   │                              # webpush.js), webpush.test.mjs (RFC-Testvektor)
│   ├── static/                    # manifest.webmanifest + icon-32/192/512.png
│   └── src/
│       ├── app.html               # PWA-Metas
│       ├── app.css                # Tailwind-Entry: Design-Tokens hell/dunkel
│       ├── service-worker.js      # Pass-through-fetch + push/notificationclick
│       ├── lib/
│       │   ├── pocketbase.svelte.js  # PB-Client, authStore-Spiegel, Profil-Update
│       │   ├── households.svelte.js  # eigene Haushalte, aktiver Haushalt, Mitglieder
│       │   ├── items.svelte.js       # $state der Liste + Realtime
│       │   ├── categories.svelte.js  # Kategorien des aktiven Haushalts + Realtime
│       │   ├── gundula.svelte.js     # $state des Parkplatzes + Realtime
│       │   ├── ideas.svelte.js       # $state des Ideen-Feeds + Realtime
│       │   ├── expenses.svelte.js    # $state der Ausgaben + Realtime, Cent-Aufteilung
│       │   ├── wishes.svelte.js      # $state der Wuensche der *anderen* + eigener Zaehler
│       │   ├── push.svelte.js        # Abo an-/abmelden, Zustand der Erlaubnis
│       │   ├── training.svelte.js    # privater Trainingsplan: Tage, Uebungen, Gewichte
│       │   ├── easteregg.svelte.js   # Osterei: 5%-Wurf, Tippzaehler, Flugzustand
│       │   ├── utils.js              # cn() = clsx + tailwind-merge
│       │   ├── components/ui/        # shadcn-svelte, CLI-Output (nicht haendisch pflegen)
│       │   ├── Dragon.svelte         # Pixelsprite als Zeichenraster + Flug-Animation
│       │   └── Nav.svelte            # Topbar + Burgermenue (Sheet)
│       └── routes/                # +layout.js (ssr=false), +layout.svelte (Guard +
│                                  # Rahmen mit Nav), +page.svelte (Liste),
│                                  # items/[id]/ (Titel + Beschreibung eines
│                                  # Eintrags), ideen/ (Feed der
│                                  # Erweiterungsvorschlaege), einstellungen/
│                                  # (Kategorien + Autoname, nur Haupt-Mitglieder),
│                                  # ausgaben/ (teilen,
│                                  # Salden, wer-schuldet-wem), profile/,
│                                  # wuensche/ (Wuensch dir was: eigene Wuensche
│                                  # sind unsichtbar, nur gezaehlt), training/
│                                  # (Gewichte eintragen; einstellungen/ = Trainings,
│                                  # Uebungen, Tage; privat, im Menue nur mit
│                                  # users.show_training), residents/,
│                                  # login/
├── pb/
│   ├── pocketbase(.exe)           # gitignored, v0.23+ noetig (getestet: 0.40.2)
│   ├── pb_migrations/             # JS-Migrationen, laufen beim Start automatisch
│   ├── pb_hooks/                  # push.pb.js (Hook-Anmeldungen), push-lib.js
│   │                              # (Schluessel/Empfaenger/Versand), wishes.pb.js
│   │                              # (Doppelte-Pruefung + Zaehler-Route), training.pb.js
│   │                              # + training-lib.js (Cron-Erinnerung), webpush.js
│   │                              # GENERIERT
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
  gemessen **über 100 Requests in 1,2 Sekunden** ohne jede Bedienung. Zwei Dinge daran
  sind bemerkenswert: es fällt nicht auf (die Liste sieht richtig aus, `svelte-check` ist
  still, der Build ist grün — nur der Netzwerk-Tab schreit), und es frisst nebenbei jede
  Meldung in `store.error` auf, weil jede Runde sie zurücksetzt. Ein Zustand, der nur
  *steuert*, wie geladen wird, gehört deshalb in eine gewöhnliche Modulvariable
  (`let loadedOnce = false`), nicht in `$state`. Beim Ändern eines `$effect` immer fragen:
  liest das hier etwas, das der eigene Rückweg schreibt? Und danach die Requests zählen,
  nicht nur die Anzeige ansehen.
* **Vite-Plugin-Import:** `import { sveltekit } from '@sveltejs/kit/vite'` — *nicht* aus
  `@sveltejs/vite-plugin-svelte`, das exportiert kein `sveltekit`.

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
  `id = @request.auth.id` lässt nur den eigenen Datensatz durch. Welche Migration was
  öffnet, steht in [migrationen.md](docs/pitfalls/migrationen.md#api-rules).
* **`expand` muss an *jeden* Call**, sonst fehlt der Name genau im ungetesteten Pfad:
  `getFullList({ expand })`, `create(data, { expand })`, `update(id, data, { expand })`
  und — leicht übersehen — `subscribe('*', cb, { expand })` als **drittes** Argument.
* Beim optimistischen Toggle auch `item.expand.done_by` lokal setzen (der eigene User
  steht im `authStore`), sonst springt der Name erst mit dem Realtime-Event nach.
* Optimistische Updates (Toggle, Delete) rollen bei einem Fehler den vorherigen Zustand
  zurück; der Fehler landet in `store.error`.

## Sonstiges

* `build.sh` löscht `pb/pb_public/` vor jedem Build; dort abgelegte Dateien (auch ein
  `.gitkeep`) überleben das nicht.
* Der Bash-Tool-Arbeitsordner bleibt zwischen Aufrufen bestehen — kein blindes
  `cd frontend && …` voranstellen.
* Lange Markdown-Dateien über das `Write`-Tool schreiben; als Bash-Heredoc brechen sie am
  Quoting.
* **`npx prettier --write` schreibt hier den falschen Stil.** Symptom: eine gerade
  angelegte Datei kommt mit doppelten Anführungszeichen und Zwei-Leerzeichen-Einrückung
  zurück, während der Rest des Projekts Tabs und einfache Anführungszeichen nutzt. Es
  gibt **keine** Prettier-Konfiguration im Repo (und kein `format`-Skript) — `npx` greift
  auf die Defaults zurück und `.svelte` kann es ohne Plugin gar nicht parsen. Also nicht
  formatieren lassen, sondern im Stil der Nachbardatei schreiben.
* **Auf dieser Maschine gibt es kein `python`.** Symptom: „Python wurde nicht gefunden;
  ohne Argumente ausführen, um aus dem Microsoft Store zu installieren" — der `python`
  im PATH ist nur der Store-Stub aus `WindowsApps`. Für kleine Skripte `node -` mit
  Heredoc nehmen.
* **`command not found` für ein Kommando, das es offensichtlich gibt** (`systemctl` auf
  einem systemd-Server). Erkennungszeichen ist die Escape-Sequenz in der Meldung selbst:
  `bash: $'\033[200~systemctl': command not found`, in der Terminalausgabe je nach Shell
  als `^[[200~`. Das ist der Bracketed-Paste-Marker, den das Terminal beim Einfügen
  mitschickt und den die Shell als Text übernommen hat statt als Steuerzeichen. Abstellen
  mit `bind 'set enable-bracketed-paste off'` oder die Zeile tippen statt einfügen.
* Bewusst *nicht* enthalten: mehrere Listen, Vorlagen, Statistiken, Offline-Caching.
  `quantity` existiert im Schema und wird angezeigt, hat aber noch kein Eingabefeld
  (`note` bearbeitet die Detailseite `items/[id]`).
