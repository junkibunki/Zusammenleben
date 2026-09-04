# Designsystem: Tailwind v4 + shadcn-svelte

Lesen, bevor du an UI-Komponenten, `app.css` oder Layout arbeitest.

Alle UI-Bausteine kommen aus **shadcn-svelte** (Style `vega`, Basisfarbe `neutral`), das
Layout aus Tailwind-Utilities. Es gibt keine handgeschriebenen Komponenten-Styles.

## Werkzeug

* **`shadcn` und `shadcn-svelte` sind zwei Projekte.** `shadcn/ui` ist React-only; für
  Svelte gilt `shadcn-svelte` (eigene CLI, eigene Registry, Unterbau `bits-ui`).
* **Komponenten nicht von Hand pflegen.** `src/lib/components/ui/**` ist CLI-Output.
  Nachziehen mit `npx shadcn-svelte add <name>` (`-o` überschreibt). Eigene Anpassungen
  gehören in die aufrufende Seite, nicht in die generierte Datei.
* **`shadcn-svelte init` läuft nicht ohne TTY durch.** Symptom: `--preset default` (oder
  jeder Name aus der Liste) wird als „is not a valid preset" abgelehnt, danach fragt die
  CLI interaktiv und hängt. `--preset` erwartet keinen Namen, sondern den Code von
  `shadcn-svelte.com/create`. Ausweg: `components.json` selbst schreiben — `add` braucht
  nur diese Datei und kennt `-y`. Registry:
  `https://shadcn-svelte.com/registry/styles/<style>/<komponente>.json`, Farb-Tokens
  unter `…/registry/colors/<basisfarbe>.json` (daraus ist `app.css` erzeugt).

## Tailwind v4

* **Kein `tailwind.config.js` mehr.** Konfiguration steckt in `app.css`:
  `@import 'tailwindcss'`, Tokens als CSS-Variablen, `@theme inline` bildet sie auf
  Utility-Namen ab (`--color-card` → `bg-card`), `@utility` definiert eigene (hier
  `safe-t` / `safe-b` für die iPhone-Safe-Areas).
* **Dark Mode über `prefers-color-scheme` braucht eine eigene `@custom-variant`.** Die
  shadcn-Vorgabe `@custom-variant dark (&:is(.dark *))` ist ein Klassenschalter; ohne
  Umstellung auf `@custom-variant dark (@media (prefers-color-scheme: dark))` greifen die
  `dark:`-Utilities *in den generierten Komponenten* nie. Symptom: dunkel sieht fast
  richtig aus, einzelne Flächen (z.B. `dark:bg-input/30`) bleiben hell.
* **`--chart-*` und `--sidebar-*` sind bewusst aus `app.css` entfernt** (nichts nutzt
  sie, und die Sidebar-Akzente sind dunkel blau — das widerspricht „neutral"). Wer per
  `add` eine Chart- oder Sidebar-Komponente holt, muss die Tokens aus
  `…/registry/colors/neutral.json` wieder eintragen.
* Der `vega`-Preset nennt Inter als Schrift; die ist hier **nicht** eingebunden.
  Tailwinds `--font-sans` ist bereits ein System-Stack — kein Webfont, kein Fremd-Request.

## Komponenten-Fallen

**Ein `<form>` um `Card.Header`/`Content`/`Footer` frisst die Abstände.** `Card.Root` ist
`flex flex-col gap-(--card-spacing)`; die Abschnitte haben selbst nur waagerechtes
Padding. Sitzt ein Wrapper dazwischen, klebt der Inhalt aneinander (Symptom: Label direkt
unter der Description). Der Wrapper muss die Rhythmik übernehmen:
`<form class="flex flex-col gap-(--card-spacing)">`.

**Die `Checkbox` von bits-ui ist ein `<button role="checkbox">`.** Ein verstecktes
`<input type="checkbox">` rendert sie nur, wenn `name` gesetzt ist. Ein `<label>`
drumherum schaltet sie also nicht zuverlässig und kann doppelt auslösen. Deshalb in der
Liste: Checkbox trägt den zugänglichen Namen (`aria-label={item.name}`), der antippbare
Rest der Zeile ist ein eigener Button mit `tabindex="-1"` und `aria-hidden` — ein
Bedienelement für Screenreader, zwei Trefferflächen für den Daumen.

**Für einen Datei-Dialog reicht ein Button.** `<input type="file" class="hidden">` plus
`onclick={() => input?.click()}` am shadcn-`Button`: die Tastatur bedient den Button, das
Feld bleibt aus der Tab-Reihenfolge.

**Tap-Targets kommen nicht von allein, auch nicht mit `size="lg"`.** shadcn ist für die
Maus gebaut: `default` = `h-9` (36px), `lg` = `h-10` (**40px**), `icon` = `size-9`,
`sm` = `h-8`. Für die 44px dieser App muss die Höhe explizit dazu: `class="h-11"` bzw.
`class="size-11"`. Nachmessen statt schätzen.

**Eine Variante schlägt die nackte Utility-Klasse, und `tailwind-merge` merkt es nicht.**
Symptom: `<Select.Trigger class="h-11">` bleibt 36px hoch. Ursache: der Trigger bringt
`data-[size=default]:h-9` mit; kompiliert ist das
`.data-\[size\=default\]\:h-9[data-size=default]` (Spezifität 0,2,0) und gewinnt gegen
`.h-11` (0,1,0). `tailwind-merge` kann nicht entwirren, weil Variante und nackte Klasse
für es verschiedene Gruppen sind. Also über dieselbe Variante setzen:
`class="h-11 data-[size=default]:h-11"`. Genauso ist `w-72` an `Sheet.Content` wirkungslos
(`data-[side=left]:w-3/4` gewinnt) — solche Klassen sehen aus wie Code und sind keiner.

## Layout / Chrome

* **Die Höhe der Topbar steht als `--header-h` in `app.css`.** Die Eingabeleiste der
  Liste klebt mit `sticky top-(--header-h)` darunter. Ein hart notiertes `top-14` ist
  falsch, sobald `env(safe-area-inset-top)` nicht 0 ist: in der installierten iOS-PWA
  wandert der Header nach unten, die Leiste bleibt oben und verschwindet beim Scrollen
  dahinter. (Nachgemessen mit simuliertem 47px-Inset: Header 104px, Leiste bei 104px.)
* **Ein Zustand, den `animationend` zurücksetzt, bleibt irgendwann hängen.** Symptom
  wäre: eine einmalige Animation läuft genau einmal und danach nie wieder, ohne Fehler und
  ohne Log. Ursache: der Browser hält CSS-Animationen in einem unsichtbaren Tab an, das
  Event kommt also nie — dasselbe, wenn das Element vor dem Ende ausgehängt oder per
  `display:none` versteckt wird (z.B. `prefers-reduced-motion`, nachträglich umgestellt).
  Wer `animationend` als Signal nutzt, braucht daneben einen Timer als Notbremse
  (`easteregg.svelte.js`: 8 s, in `landed()` gecleart). Hier vorbeugend behandelt, nicht
  beobachtet — deshalb ist es leicht zu übersehen.
* **Wer über der Karte liegen will, muss über Leaflet liegen.** Leaflet vergibt Panes und
  Controls z-index bis 1000. Der Kartenrahmen auf der Gundula-Seite hat deshalb `isolate`;
  nur dadurch genügt einem Overlay darüber ein kleiner z-index. Fehlt das `isolate`
  irgendwann, verschwindet ein `fixed`-Element mit `z-40` hinter den Kartenkacheln —
  sichtbar nur auf dieser einen Seite.
* **Ein Bedienelement, das mehrfach schnell angetippt wird, braucht
  `touch-manipulation`.** Der Viewport in `app.html` erlaubt Zoom (kein
  `user-scalable=no`), also deutet iOS Safari zwei schnelle Taps als
  Double-Tap-Zoom: die Seite zoomt, statt das Ereignis ein zweites Mal zu liefern.
  Betrifft nur Mehrfach-Tap-Gesten (hier die fuenf Tipps aufs Profilbild in
  `Nav.svelte`), nicht die gewoehnlichen Knoepfe. Vorbeugend gesetzt, auf einem
  iPhone nicht nachgeprueft — am Desktop ist der Fall unsichtbar.
* **`theme-color` zweimal setzen**, je `prefers-color-scheme` — sonst bleibt die
  Browserleiste hell, während die App fast schwarz ist. Manifest und Icon-Skript kennen
  weder `oklch` noch Variablen, dort stehen die Tokens als Hex (`#ffffff`, `#0a0a0a`,
  Icon-Hintergrund `#171717`).
