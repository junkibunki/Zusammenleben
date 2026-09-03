# CLAUDE.md — Familien-Einkauf

Notizen für zukünftige Sessions. Ergänzt das [README](README.md) (das erklärt Setup und
Deploy für Menschen); hier steht, was beim Arbeiten am Code stolpert.

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
* Testdaten liegen in `pb/pb_data/` — zum Zurücksetzen einfach den Ordner löschen und
  den Superuser neu anlegen.

## Sonstiges

* `build.sh` löscht `pb/pb_public/` vor jedem Build; dort abgelegte Dateien (auch ein
  `.gitkeep`) überleben das nicht.
* Der Bash-Tool-Arbeitsordner bleibt zwischen Aufrufen bestehen — kein blindes
  `cd frontend && …` voranstellen.
* Lange Markdown-Dateien über das `Write`-Tool schreiben; als Bash-Heredoc brechen sie
  am Quoting.
* Bewusst *nicht* enthalten: mehrere Listen, Vorlagen, Statistiken, Offline-Caching.
  `quantity` und `note` existieren im Schema und werden angezeigt, haben aber noch kein
  Eingabefeld.
