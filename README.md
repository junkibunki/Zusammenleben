# Familien-Einkauf

Gemeinsame Einkaufsliste als leichtgewichtige PWA.
Ein einziger Prozess (PocketBase) liefert API **und** Frontend auf demselben Port.

```
/
├── frontend/          # SvelteKit (Svelte 5 Runes, SPA)
├── pb/                # PocketBase-Binary, pb_data/, pb_public/, pb_migrations/
├── build.sh           # baut frontend -> pb/pb_public
└── README.md
```

## Stack

| Teil     | Technik                                                      |
| -------- | ------------------------------------------------------------ |
| Backend  | PocketBase (Go-Binary, SQLite) – kein eigener Backend-Code    |
| Frontend | SvelteKit + Svelte 5 Runes, `@sveltejs/adapter-static` (SPA)  |
| Styling  | handgeschriebenes CSS, mobile-first, Touch-Ziele 44px         |

---

## Lokal entwickeln

**1. PocketBase besorgen** (einmalig) – Release von <https://github.com/pocketbase/pocketbase/releases>
herunterladen und das Binary nach `pb/` legen (`pb/pocketbase` bzw. `pb/pocketbase.exe`).
Benötigt wird **v0.23 oder neuer**, weil die Migrationen die neue JSVM-API nutzen
(`app.save(collection)`, `fields: [...]`). Getestet mit **v0.40.2**.

**2. PocketBase starten** – die Migrationen aus `pb/pb_migrations/` laufen beim Start automatisch:

```bash
cd pb && ./pocketbase serve
```

**3. Superuser anlegen** per CLI, in einem **zweiten Terminal** (der Server aus Schritt 2
läuft im Vordergrund) – seit v0.23 gibt es unter `/_/` keine offene Maske mehr dafür,
sondern nur einen Einmal-Link mit Token im Serverlog:

```bash
cd pb && ./pocketbase superuser upsert admin@example.com EINPASSWORT
```

Danach unter <http://127.0.0.1:8090/_/> anmelden und dort die
Familien-Accounts in der Collection `users` anlegen (Feld `name` ausfüllen) – Selbstregistrierung ist per
Migration abgeschaltet, ein `POST /api/collections/users/records` ohne Admin-Token
antwortet mit `403`.

**4. Frontend-Dev-Server:**

```bash
cd frontend && npm install && npm run dev
```

Läuft auf <http://localhost:5173>. Vite proxied `/api` und `/_` auf `127.0.0.1:8090`,
dadurch gibt es lokal kein CORS und dieselbe Origin-Situation wie in Produktion.

## Bauen

```bash
./build.sh
```

Schreibt das fertige SPA nach `pb/pb_public/`. PocketBase serviert diesen Ordner
automatisch inklusive SPA-Fallback auf `index.html`.
Danach ist alles unter `http://127.0.0.1:8090/` erreichbar – Frontend und API.

---

## Datenmodell

Collection `items` (Migration `pb/pb_migrations/1756000000_created_items.js`):

| Feld                  | Typ              | Hinweis                                                        |
| --------------------- | ---------------- | -------------------------------------------------------------- |
| `name`                | text             | required                                                       |
| `quantity`            | text             | optional, Freitext ("2 Packungen")                             |
| `category`            | select (1)       | Obst/Gemüse, Kühlregal, Trocken, Getränke, Drogerie, Sonstiges |
| `done`                | bool             | nicht gesetzt = false                                          |
| `note`                | text             | optional                                                       |
| `added_by`            | relation → users |                                                                |
| `done_by`             | relation → users | optional                                                       |
| `created` / `updated` | autodate         | PocketBase-Automatik                                           |

API-Rules für List/View/Create/Update/Delete jeweils `@request.auth.id != ""`.
Bewusst grob – innerhalb einer Familie braucht es keine feingranularen Rechte.

`users.createRule` wird per zweiter Migration auf `null` gesetzt: niemand kann sich
selbst registrieren, Accounts legt der Admin an.

`users.viewRule` steht per dritter Migration auf `@request.auth.id != ""`. Ohne das
liefert `expand=added_by,done_by` leere Objekte – PocketBase prüft beim Expand die
ViewRule der Zielcollection, und die lässt per Default nur den eigenen Datensatz durch.
`listRule` bleibt bewusst eng (`users` soll nicht komplett auflistbar sein), Ändern
bleibt auf den eigenen Account beschränkt.

**Beim Anlegen eines Accounts das Feld `name` ausfüllen.** Es ist das einzige Feld, das
für die anderen Familienmitglieder sichtbar ist – `email` liefert PocketBase nur bei
gesetztem `emailVisibility` bzw. für den eigenen Account aus. Ohne Namen steht in der
Zeile „Jemand“.

Jede Zeile zeigt darunter klein und ausgegraut, wer den Eintrag wann hinzugefügt hat
(`added_by` + `created`); bei erledigten Einträgen zusätzlich „gekauft von …“
(`done_by`). Das Datum ist am selben Tag „heute 19:41“, sonst „3. Sept. 19:41“.

---

## Deployment auf einem STRATO-VPS

### Voraussetzung

Ein **A-Record** der (Sub-)Domain muss auf die VPS-IP zeigen, *bevor* PocketBase startet –
sonst schlägt die Let's-Encrypt-Ausstellung fehl.

### Achtung: STRATO hat zwei Firewalls

Das ist die häufigste Fehlerquelle. Ports 80 **und** 443 müssen an **beiden** Stellen offen sein:

1. auf dem Server selbst (`ufw allow 80,443/tcp` bzw. `iptables`)
2. im **STRATO-Kundenbereich** unter *Server → Firewall* – dort gibt es eine zweite,
   vorgelagerte Paketfilter-Regelung

Ist Port 80 auch nur an einer der beiden Stellen zu, bekommt PocketBase kein Zertifikat
(die ACME-HTTP-01-Challenge läuft über Port 80).

### Dateien hochladen

```bash
rsync -av --exclude pb_data --exclude "pocketbase*" pb/ root@SERVER:/var/www/mein-projekt/
```

`pb_data/` bleibt auf dem Server, das ist die Datenbank. Das Binary bleibt ebenfalls
außen vor: lokal liegt dort der Build der eigenen Plattform (unter Windows eine `.exe`),
und den kann Linux nicht ausführen – die Unit scheitert dann mit `status=203/EXEC`. Auf
den Server gehört das Linux-Release, siehe „Automatisches Deployment" weiter unten.

### Start mit HTTPS

PocketBase holt sich das Zertifikat selbst:

```bash
./pocketbase serve --http=0.0.0.0:80 --https=0.0.0.0:443 einkauf.MEINEDOMAIN.de
```

### systemd-Unit

`/etc/systemd/system/pocketbase.service`:

```ini
[Unit]
Description=PocketBase (Familien-Einkauf)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/mein-projekt
ExecStart=/var/www/mein-projekt/pocketbase serve --http=0.0.0.0:80 --https=0.0.0.0:443 einkauf.MEINEDOMAIN.de
Restart=always
RestartSec=5
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now pocketbase
journalctl -u pocketbase -f
```

Port 80/443 sind privilegiert. Entweder – wie oben – als `root` laufen lassen, oder
einen eigenen User nehmen und die Capability vergeben:

```ini
User=pocketbase
Group=pocketbase
AmbientCapabilities=CAP_NET_BIND_SERVICE
```

Dann muss `/var/www/mein-projekt` diesem User gehören.

### Automatisches Deployment per GitHub Actions

`.github/workflows/deploy.yml` baut bei jedem Push auf `main` das Frontend und lädt
`pb_public/` und `pb_migrations/` auf den Server. Der manuelle `rsync` oben wird danach
nicht mehr gebraucht.

Einmalig einzurichten:

1. **Zielverzeichnis anlegen und das PocketBase-Binary manuell dorthin legen.** Der
   Workflow fasst das Binary bewusst nicht an: ein PocketBase-Upgrade soll nicht als
   Nebenwirkung eines Frontend-Pushs passieren. Passendes **Linux**-Release nehmen
   (`uname -m`: `x86_64` -> `amd64`, `aarch64` -> `arm64`):

   Beide Blöcke als root ausführen; wer als anderer User arbeitet, setzt jeweils `sudo`
   davor.

   ```bash
   apt-get install -y wget unzip
   ```

   ```bash
   mkdir -p /var/www/mein-projekt && cd /var/www/mein-projekt && wget https://github.com/pocketbase/pocketbase/releases/download/v0.40.2/pocketbase_0.40.2_linux_amd64.zip && unzip -o -j pocketbase_0.40.2_linux_amd64.zip pocketbase && chmod +x pocketbase && rm pocketbase_0.40.2_linux_amd64.zip
   ```

   Fehlt das Binary, startet die Unit mit `status=203/EXEC` und der Healthcheck des
   Deploys läuft in `curl: (7)`. PocketBase selbst loggt dabei nichts — der Prozess ist
   nie angelaufen. Die Ursache loggt systemd: `journalctl -u pocketbase` zeigt dann
   `Failed to locate executable ...` bzw. `Failed at step EXEC`.
2. **systemd-Unit einrichten** (siehe oben).
3. **`TARGET` und `DOMAIN` im Workflow an die Unit angleichen.** `TARGET` muss dem
   `WorkingDirectory` entsprechen, sonst lädt der Deploy am laufenden Dienst vorbei und
   nichts ändert sich sichtbar. `DOMAIN` muss die Domain aus dem `ExecStart` sein: nur
   für die hat PocketBase ein Zertifikat, und der Healthcheck am Ende des Deploys fragt
   genau diese Adresse ab (per `--resolve` auf `127.0.0.1`, also ohne Umweg über DNS).
   Steht dort ein anderer Name, scheitert der TLS-Handshake und der Deploy geht rot,
   obwohl die App einwandfrei läuft. Nachsehen mit:

   ```bash
   systemctl show pocketbase -p WorkingDirectory -p ExecStart
   ```

4. **SSH-Key-Login einrichten.** Ein VPS kommt in der Regel mit Passwort-Login; die
   Action kann damit nichts anfangen. Also lokal ein Schlüsselpaar erzeugen (falls noch
   keins da ist) und den *öffentlichen* Teil auf dem Server hinterlegen:

   ```bash
   ssh-keygen -t ed25519 -C github-actions -f ~/.ssh/deploy_einkauf
   ssh-copy-id -i ~/.ssh/deploy_einkauf.pub SSH_USER@SERVER
   ```

   Unter Windows gibt es `ssh-copy-id` nicht, dort erledigt das eine Zeile in der
   PowerShell:

   ```powershell
   type $env:USERPROFILE\.ssh\deploy_einkauf.pub | ssh SSH_USER@SERVER "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
   ```

   Der Key gehört in `~/.ssh/authorized_keys` **des `SSH_USER`** – bei
   einem Service-User also nicht an den von root. Fehlt der Schritt, scheitert schon der
   erste Deploy-Step mit `ssh: handshake failed: ... unable to authenticate`. Danach
   einmal von Hand `ssh -i ~/.ssh/deploy_einkauf SSH_USER@SERVER` testen.

5. **Repository-Secrets** unter *Settings → Secrets and variables → Actions* anlegen:

| Secret           | Inhalt                                                       |
| ---------------- | ------------------------------------------------------------ |
| `SSH_HOST`       | IP oder Hostname des VPS                                     |
| `SSH_USER`       | SSH-Benutzer (`root`, oder der Service-User)                  |
| `SSH_KEY`        | **privater** Key (`~/.ssh/deploy_einkauf`), vollständig inkl. `-----BEGIN`-Zeile |
| `SSH_PASSPHRASE` | nur falls der Key eine hat, sonst leer lassen                 |

Was der Workflow tut: `.deploy/` auf dem Server leeren, dorthin hochladen, prüfen dass
beide Ordner vollständig angekommen sind, Dienst stoppen, `pb_data/` nach
`pb_data.bak/` sichern, `pb_public/` durch die neue Version ersetzen und
`pb_migrations/` ergänzen, Dienst starten, `/api/health` pollen. Erst der letzte Schritt
fasst den laufenden Stand an – scheitert der Upload, läuft die App unverändert weiter.

Die Sicherung vor dem Neustart ist kein Luxus: beim Start laufen die Migrationen
automatisch gegen die Produktionsdatenbank. Es wird genau **eine** Sicherung vorgehalten,
jeder Deploy überschreibt die vorherige. Existiert noch keine `pb_data/` (erster Deploy),
wird der Schritt übersprungen.

Voraussetzungen auf dem Server: `curl` ist installiert, und wenn der SSH-User **nicht**
root ist, braucht er zweierlei – die Action läuft ohne TTY, eine Passwortabfrage bricht ab:

* **Schreibrecht auf `TARGET` selbst.** Der Upload-Step nutzt kein `sudo`; gehört das
  Verzeichnis root, scheitert er, bevor überhaupt ein `sudo` greifen kann.
* **Passwortloses `sudo` für alle Kommandos des Skripts**, nicht nur `systemctl`: auch
  `rm`, `cp`, `mv` und `mkdir` laufen darüber. Ein sudoers-Eintrag, der nur
  `/bin/systemctl` erlaubt, lässt den Deploy mittendrin scheitern.

`pb_data/` selbst wird nie hochgeladen und nie gelöscht.

Eine Sicherung zurückspielen (auf dem Server, als root):

```bash
T=/var/www/mein-projekt; systemctl stop pocketbase; mv "$T/pb_data" "$T/pb_data.broken"; cp -a "$T/pb_data.bak" "$T/pb_data"; systemctl start pocketbase
```

Die kaputte Datenbank wird beiseitegelegt, nicht gelöscht – falls die Sicherung doch
älter ist als gedacht. Aufgeräumt wird von Hand, wenn die App wieder tut.

Achtung: es gibt nur **eine** Sicherung, und der nächste Push überschreibt sie. Wer einen
Migrationsschaden erst später bemerkt, hat sie dann nicht mehr. Vor riskanten
Schema-Änderungen also besser eine eigene Kopie wegschreiben.

### Erste Schritte nach dem Deploy

1. Superuser per CLI anlegen – auf dem Server:

   ```bash
   /var/www/mein-projekt/pocketbase superuser upsert DEINE@MAIL.DE EINPASSWORT
   ```

   Seit v0.23 gibt es unter `/_/` **keine** offene Maske mehr für den ersten Superuser;
   PocketBase schreibt beim ersten Start stattdessen einen einmaligen Installer-Link mit
   Token ins Log, den man unter systemd nur über `journalctl -u pocketbase` zu sehen
   bekäme. Der CLI-Weg ist kürzer. Meldet der Befehl `database is locked`, greift der
   laufende Dienst gerade auf dieselbe SQLite-Datei zu: `systemctl stop pocketbase`,
   Befehl wiederholen, wieder starten. Danach unter
   `https://einkauf.MEINEDOMAIN.de/_/` anmelden.
2. In der Collection `users` die Familien-Accounts anlegen (E-Mail + Passwort + **Name**).
3. App unter `https://einkauf.MEINEDOMAIN.de/` öffnen und auf dem Homescreen installieren.

---

## PWA

Damit die App wirklich standalone startet und nicht nur ein Lesezeichen ist, sind drei
Dinge umgesetzt:

1. **Service Worker mit `fetch`-Handler** (`frontend/src/service-worker.js`).
   Chrome zeigt "Installieren" nur, wenn ein Worker registriert ist, der einen
   `fetch`-Handler hat. Der Handler reicht hier bloß durch – kein Caching, kein
   Offline-Modus (war nicht gefordert). SvelteKit registriert `src/service-worker.js`
   im Production-Build automatisch.
2. **`<link rel="apple-touch-icon">`** in `frontend/src/app.html` – ohne das nimmt iOS
   einen Screenshot der Seite als Homescreen-Icon.
3. **`viewport-fit=cover`** im Viewport-Meta plus `env(safe-area-inset-*)` im CSS,
   sonst klebt die untere Leiste am iPhone-Homebalken.

Icons: `frontend/static/icon-192.png`, `icon-512.png`, `icon-512-maskable.png` –
Platzhalter (Einkaufstasche, weiß auf Indigo). Neu erzeugen mit:

```bash
cd frontend && node scripts/generate-icons.mjs
```

Das Skript schreibt echte PNGs ohne Abhängigkeiten (nur `node:zlib`). Zum Ersetzen
einfach eigene PNGs in `frontend/static/` ablegen.

Verifiziert gegen PocketBase 0.40.2 unter Chromium: der Service Worker ist mit Scope `/`
registriert, `activated` und kontrolliert die Seite (`navigator.serviceWorker.controller`
gesetzt); Manifest, `apple-touch-icon` und `viewport-fit=cover` werden vom PocketBase-Prozess
korrekt ausgeliefert.

> **Zwei Punkte für den ersten Deploy:**
>
> * Chrome zeigt den Install-Prompt nur über **HTTPS** – lokal ist nur `localhost`
>   ausgenommen. Auf dem VPS also erst das Let's-Encrypt-Setup, dann testen.
> * PocketBase liefert `manifest.webmanifest` mit dem MIME-Typ aus, den das Betriebssystem
>   für die Endung kennt. Unter Windows ist das `text/plain`, unter Linux (via
>   `/etc/mime.types`) meist `application/manifest+json`. Chrome prüft den MIME-Typ des
>   Manifests nicht, das ist also unkritisch – im Zweifel unter
>   *DevTools → Application → Manifest* gegenprüfen.

---

## Frontend-Aufbau

```
frontend/src/
├── app.html                   # PWA-Metas: manifest, apple-touch-icon, viewport-fit
├── app.css                    # globales CSS, mobile-first
├── service-worker.js          # trivialer Pass-through-Handler
├── lib/
│   ├── pocketbase.svelte.js   # PB-Client + reaktiver authStore-Spiegel
│   └── items.svelte.js        # $state der Liste + Realtime-Subscription
└── routes/
    ├── +layout.js             # ssr = false, prerender = false
    ├── +layout.svelte         # Auth-Guard / Redirects
    ├── +page.svelte           # Liste, Hinzufügen, Abhaken, Löschen
    └── login/+page.svelte     # E-Mail + Passwort
```

### Realtime

`items.svelte.js` hält den State und verwaltet die Subscription. Wichtig: es werden
**immer nur einzelne Items** mutiert (`push` / `splice` / `items[i] = …`), nie die
Liste als Ganzes ersetzt. Dadurch kollidieren gleichzeitige Änderungen zweier
Personen nicht.

Abhaken und Löschen sind optimistisch: erst lokal, dann Server. Schlägt der Request
fehl, wird der vorherige Zustand zurückgerollt.

---

## Was getestet wurde

End-to-End gegen PocketBase 0.40.2, Frontend aus `pb/pb_public` vom selben Prozess serviert:

* Migrationen laufen beim Start durch; `items` hat alle Felder inkl. `select`-Werte
  mit Umlauten, alle fünf Rules stehen auf `@request.auth.id != ""`.
* `users.createRule` ist `null`, Selbstregistrierung liefert `403`.
* Login, Redirect `/` → `/login` und zurück, Session übersteht einen Reload.
* Hinzufügen per Enter, Gruppierung nach Kategorie, Abhaken per Tap
  (`done` **und** `done_by` landen korrekt in der DB), Löschen per „×“, „Aufräumen“.
* **Realtime in beide Richtungen:** ein zweiter Client (via API als anderer User)
  legt an, hakt ab und löscht – alles erscheint ohne Reload in der offenen UI.
* Touch-Ziele gemessen: Zeile 44px, „×“ 44×44, Eingabefeld, Dropdown, „Aufräumen“
  und „Abmelden“ ebenfalls 44px. Kein horizontales Scrollen bei 390px Breite.
* Service Worker registriert und aktiv, SPA-Fallback (`/login` direkt aufgerufen)
  liefert `200 text/html`.

---

## Notizen zu Abweichungen

Wo zwei Wege möglich waren, wurde der einfachere genommen:

* **`+layout.js` statt `+layout.ts`.** Das Projekt ist reines JavaScript, ein
  TS-Setup wäre nur Ballast. Inhalt identisch (`ssr = false`, `prerender = false`).

* **`syncItems()` statt `$effect` auf Modulebene.** Der Vorschlag aus der Spezifikation
  ruft `$effect` direkt in einem Modul auf – das wirft in Svelte 5 `effect_orphan`,
  Runes-Effekte brauchen einen Effekt-Kontext. Stattdessen exportiert
  `items.svelte.js` die Funktion `syncItems()`, die Laden + Subscription startet und
  das Teardown zurückgibt; `+page.svelte` ruft sie aus seinem `$effect` auf. Die Logik
  im Subscription-Handler ist unverändert.

* **`store.items` statt eines exportierten `let items = $state([])`.** Svelte 5
  verbietet den Export einer `$state`-Variablen, die neu zugewiesen wird. Ein
  `$state`-Objekt mit `items`-Property tut dasselbe und passt zur Regel
  "nur einzelne Items synchronisieren".

* **Löschen per `splice` statt `filter`.** `filter` würde die Liste komplett
  ersetzen – genau das, was laut Spezifikation vermieden werden soll.

* **"×"-Button statt Swipe.** Die Spezifikation lässt beides zu ("Swipe oder ein
  kleines X"); der Button kommt ohne Gesten-Handling und ohne Konflikte mit dem
  Scrollen aus und ist auf 44px Touch-Ziel gebracht.

* **Erledigte Items sind standardmäßig eingeklappt** (Kopfzeile mit Anzahl zum
  Aufklappen) statt dauerhaft sichtbar-ausgegraut – hält die Liste auf dem Handy kurz.

* **`quantity` und `note` sind im Schema angelegt und werden in der Liste angezeigt,
  haben aber noch kein Eingabefeld.** Die erste Version hat bewusst nur das eine Feld
  ganz oben; die Felder existieren jetzt schon, damit später keine Schema-Migration
  nötig ist.

Nicht enthalten (bewusst): mehrere Listen, Vorlagen, Statistiken, Offline-Caching.
