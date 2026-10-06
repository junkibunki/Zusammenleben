# Zusammenleben

Gemeinsame Einkaufsliste als leichtgewichtige PWA – inzwischen mit allem, was ein
Haushalt sonst noch teilt.
Ein einziger Prozess (PocketBase) liefert API **und** Frontend auf demselben Port.

## Was die App kann

| Seite | Inhalt |
| ----- | ------ |
| **Liste** (`/`) | Einträge nach Kategorie („Wo einkaufen?“) gruppiert, abhaken, löschen, Kategorien einzeln einklappen. Jede Zeile zeigt, wer sie wann angelegt und wer gekauft hat. Die Detailseite (`/items/[id]`) bearbeitet Titel und Beschreibung (`note`). |
| **Wo ist …** (`/gundula`) | Wo das Auto des Haushalts steht: „hier parken“ speichert den aktuellen Standort, die Karte (Leaflet + OpenStreetMap) zeigt ihn. Der Name des Autos kommt aus `households.car_name`. |
| **Ausgaben** (`/ausgaben`) | Beträge auf ausgewählte Bewohner aufteilen (auf den Cent), auch Erstattungen als negative Beträge. Salden, wer wem was schuldet, Begleichen per Tipp. |
| **Wünsch dir was** (`/wuensche`) | Geschenkewünsche. Die eigenen sieht man nach dem Speichern nie wieder – nur einen Zähler. |
| **Ideen** (`/ideen`) | App-weiter Feed mit Erweiterungsvorschlägen; abhaken als „umgesetzt“ oder „abgelehnt“, liken (nicht die eigene Idee). Offene Ideen sortiert nach Likes. |
| **Training** (`/training`) | Privater Trainingsplan: mehrere Trainings mit Übungen, Gewichte eintragen, das Gewicht vom letzten Mal daneben, Push-Erinnerung an gewählten Wochentagen. Steht nur im Menü, wenn im Profil „Training anzeigen“ an ist. |
| **Einstellungen** (`/einstellungen`) | Kategorien des Haushalts anlegen, umbenennen, sortieren, löschen; Name des Autos. Nur für Haupt-Mitglieder. |
| **Bewohner** (`/residents`) | Wer im aktiven Haushalt einen Account hat. |
| **Haushalte** (`/haushalte`) | Wechsel des aktiven Haushalts, wenn man in mehreren Mitglied ist. |
| **Profil** (`/profile`) | Foto und Name ändern, Benachrichtigungen pro Gerät, Training ein-/ausblenden. |

Dazu ein Osterei: fünf Tipps aufs Profilbild (oder mit 5 % Glück einfach so) schicken einen
Pixeldrachen durchs Bild.

```
/
├── frontend/                  # SvelteKit (Svelte 5 Runes, SPA)
├── pb/
│   ├── pb_migrations/         # Schema + API-Rules, laufen beim Start automatisch
│   ├── pb_hooks/              # serverseitige Logik (Push, Prüfungen, Cron)
│   ├── pb_data/               # gitignored, die SQLite-DB
│   └── pb_public/             # gitignored, Build-Output
├── docs/pitfalls/             # Stolpersteine nach Thema
├── .github/workflows/         # deploy.yml: Build + Deploy auf den VPS
├── build.sh                   # baut frontend -> pb/pb_public
└── README.md
```

## Stack

| Teil     | Technik                                                                 |
| -------- | ----------------------------------------------------------------------- |
| Backend  | PocketBase (Go-Binary, SQLite) plus JS-Hooks in `pb/pb_hooks/`           |
| Frontend | SvelteKit + Svelte 5 Runes, `@sveltejs/adapter-static` (SPA)             |
| Styling  | Tailwind CSS v4 + shadcn-svelte, mobile-first, Touch-Ziele 44px          |
| Karte    | Leaflet mit OpenStreetMap-Kacheln                                        |
| Push     | Web Push (RFC 8291/8292) direkt aus PocketBase, ohne externen Dienst     |

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
Accounts in der Collection `users` anlegen (Feld `name` ausfüllen) – Selbstregistrierung ist per
Migration abgeschaltet, ein `POST /api/collections/users/records` ohne Admin-Token
antwortet mit `403`.

**Haushalte:** ebenfalls im Admin-UI. In `households` einen Haushalt anlegen (`name`
und `car_name` – wie das Auto auf der Seite „Wo ist …“ heißt, Bestand: „Gundula“), dann
in `memberships` je Person und Haushalt eine Zeile:

* `role = haupt` – der Haupthaushalt, höchstens einer pro Person (Unique-Index), ohne
  `until`.
* `role = gast` – beliebig viele, `until` optional: ab diesem Zeitpunkt ist der Haushalt
  für den Gast gesperrt. Leer heißt: bis die Zeile gelöscht wird.

Den Standort-Record für „Wo ist …“ legt ein Hook beim Anlegen des Haushalts selbst an.
Kategorien legen Haupt-Mitglieder danach in der App unter *Einstellungen* an.

Wer keine laufende Mitgliedschaft hat, sieht in der App nur einen Hinweis (plus Ideen und
Profil). Wer in mehreren Haushalten ist, wechselt über den Knopf unten im Menü. Beim Update auf diese Version
legt die Migration `1789304400` den Haushalt „Zuhause“ an, hängt alle Bestandsdaten
daran und macht alle vorhandenen Accounts dort zu Haupt-Mitgliedern.

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

Schreibt das fertige SPA nach `pb/pb_public/` und erzeugt dabei auch
`pb/pb_hooks/webpush.js` neu (das gebündelte Krypto-Modul für die
Benachrichtigungen – es liegt im Repo, damit der Server kein npm braucht).
PocketBase serviert `pb_public/` automatisch inklusive SPA-Fallback auf `index.html`.
Danach ist alles unter `http://127.0.0.1:8090/` erreichbar – Frontend und API.

> [!NOTE]
> Änderungen in `pb/pb_hooks/` wirken erst nach einem **Neustart** von PocketBase.
> Der Server schreibt dann nur `File ... changed, please restart the app manually`
> und läuft mit dem alten Code weiter.

---

## Datenmodell

Das Schema steht vollständig in `pb/pb_migrations/`; jede Migration erklärt im Kopf,
warum sie so aussieht. Überblick:

| Collection | Inhalt | Wer darf |
| ---------- | ------ | -------- |
| `users` | Accounts mit `name`, `avatar`, `show_training` | Selbstregistrierung aus (`createRule = null`); sichtbar sind man selbst und Mitbewohner |
| `households` | `name`, `car_name` | nur Superuser schreibt |
| `memberships` | `user`, `household`, `role` (`haupt`/`gast`), `until` | nur Superuser schreibt |
| `items` | Einkaufszettel: `name`, `quantity`, `note`, `category`, `done`, `added_by`, `done_by` | laufende Mitglieder des Haushalts |
| `categories` | „Wo einkaufen?“ pro Haushalt, `name`, `sort` | lesen: Mitglieder; ändern: Haupt-Mitglieder |
| `car_location` | ein Record pro Haushalt: `lat`, `lng`, `parked_at`, `parked_by` | Mitglieder ändern; anlegen/löschen nur Server |
| `expenses` | `title`, `amount_cents` (≠ 0, negativ = Erstattung), `paid_by`, `shared_with` | Mitglieder; Hook prüft, dass Zahler und Teilnehmer zum Haushalt gehören |
| `wishes` | `text`, `wisher` | Mitglieder, aber **nie** der Wünschende selbst |
| `ideas` | `text`, `status`, `likes`, `author` | alle Eingeloggten, app-weit; löschen nur Superuser |
| `training_*` | `plans`, `workouts`, `exercises`, `logs` | nur die eigene Person |
| `push_subscriptions` | ein Datensatz je Gerät | nur die eigene Person |
| `push_config` | Record `vapid` mit dem Schlüsselpaar des Servers | nur Superuser |

Alles außer Ideen, Training und Push hängt über ein Pflichtfeld `household` an einem
Haushalt, und jede Rule verlangt eine *laufende* Mitgliedschaft genau dort
(Migration `1789304400`, Fallstricke in [docs/pitfalls/mandanten.md](docs/pitfalls/mandanten.md)).

**Beim Anlegen eines Accounts das Feld `name` ausfüllen.** Es ist das einzige Feld, das
für die anderen Nutzer sichtbar ist – `email` liefert PocketBase nur bei
gesetztem `emailVisibility` bzw. für den eigenen Account aus. Ohne Namen steht in der
Zeile „Jemand“.

Die `users`-ViewRule lässt Mitbewohner durch (auch ehemalige Gäste, damit ihr Name in alten
Ausgaben stehen bleibt), beim Einzelabruf zusätzlich Autoren im Ideen-Feed. Ohne sie
liefert `expand=added_by,done_by` leere Objekte – PocketBase prüft beim Expand die
ViewRule der Zielcollection.

Was in `pb/pb_hooks/` liegt:

| Datei | Aufgabe |
| ----- | ------- |
| `push.pb.js`, `push-lib.js`, `webpush.js` | VAPID-Schlüssel, `/api/push/key`, `/api/push/test`, Push bei neuem Eintrag und neuer Ausgabe |
| `households.pb.js` | Standort-Record für jeden neuen Haushalt, Prüfung der Mitgliedschaften |
| `expenses.pb.js` | Zahler und Teilnehmer müssen zum Haushalt gehören |
| `wishes.pb.js` | Doppelte Wünsche abfangen, Zähler-Route für die eigenen |
| `ideas.pb.js` | Likes: nur sich selbst, nicht die eigene Idee; `author` steht fest |
| `training.pb.js`, `training-lib.js` | Cron jede Minute: Trainingserinnerung nach deutscher Zeit |

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
Description=PocketBase (Einkaufsliste)
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
`pb_public/`, `pb_hooks/` und `pb_migrations/` auf den Server. Der manuelle `rsync` oben
wird danach nicht mehr gebraucht.

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
alle drei Ordner vollständig angekommen sind, Dienst stoppen, `pb_data/` nach
`pb_data.bak/` sichern, `pb_public/` und `pb_hooks/` durch die neue Version ersetzen und
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
2. In der Collection `users` die Accounts anlegen (E-Mail + Passwort + **Name**).
3. Haushalt und Mitgliedschaften anlegen bzw. prüfen (siehe „Haushalte“ unter *Lokal
   entwickeln*). Auf einer frischen Datenbank legt die Migration schon „Zuhause“ an –
   ohne Zeile in `memberships` sieht dort aber niemand etwas.
4. App unter `https://einkauf.MEINEDOMAIN.de/` öffnen und auf dem Homescreen installieren.

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

### App-Icon

Quelle ist **eine einzige Datei**: `frontend/scripts/icon-source.png` (quadratisch,
8-Bit-PNG, RGB oder RGBA, ohne Interlacing – so exportiert jedes Bildbearbeitungs­programm).
Daraus erzeugt das Skript die drei ausgelieferten Größen:

```bash
cd frontend && node scripts/generate-icons.mjs
```

| Datei                     | Wofür                                                  |
| ------------------------- | ------------------------------------------------------ |
| `static/icon-32.png`      | Favicon im Browser-Tab                                 |
| `static/icon-192.png`     | Install-Prompt in Chrome, `apple-touch-icon` für iOS   |
| `static/icon-512.png`     | Splashscreen und Android-Adaptive-Icon (`any maskable`) |

Ein eigenes Icon setzt man also so: die eigene Datei als
`frontend/scripts/icon-source.png` ablegen, Skript laufen lassen, committen. Die Quelle
liegt bewusst **nicht** in `static/` – dort würde sie in Originalgröße mit ausgeliefert.
Das Skript braucht keine Abhängigkeiten (nur `node:zlib`): es dekodiert das PNG selbst,
skaliert per Flächenmittel und kodiert wieder.

Es gibt **kein separates `maskable`-Icon**. Android beschneidet ein maskable-Icon auf die
Safe-Zone (innere 80 %); bei einem randlosen Bild trifft das nur den Rand, deshalb steht
am 512er im Manifest `"purpose": "any maskable"`. Ein Icon mit freistehendem Logo auf
transparentem Grund bräuchte stattdessen eine zweite, kleiner skalierte Variante.

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

## Benachrichtigungen

Push-Meldungen kommen auch bei geschlossener App, in drei Fällen:

* **Neuer Eintrag auf dem Zettel** – an alle anderen im Haushalt, z.B. „Neu: Möhren ·
  2 Bund“ mit „Supermarkt · von Anna“ darunter; ein Tippen darauf öffnet die Liste.
* **Neue Ausgabe oder Erstattung** – an alle anderen im Haushalt, damit niemand dieselbe
  Rechnung zweimal einträgt.
* **Trainingserinnerung** – an die Person selbst, an den Wochentagen und zur Uhrzeit aus
  dem eigenen Plan. Nur solange im Profil „Training anzeigen“ an ist.

Wer etwas anlegt, bekommt dazu selbst keine Meldung.

Einschalten muss das **jedes Gerät für sich**, unter *Profil → Benachrichtigungen*.
Dort steht auch ein Knopf **„Probe senden“**, der eine Testmeldung an die eigenen
Geräte schickt – damit lässt sich ohne zweite Person prüfen, ob es funktioniert.

- **iPhone/iPad:** Web Push gibt es dort nur in der **installierten** App (iOS 16.4+).
  Also erst in Safari über *Teilen → Zum Home-Bildschirm* hinzufügen und die App von
  dort öffnen; im normalen Safari-Tab fehlt der Knopf, und die Seite sagt warum.
- Wer versehentlich „Blockieren“ getippt hat, kann das nur in den Einstellungen des
  Browsers zurücknehmen – die Seite darf nicht nochmal fragen.
- Abmelden meldet das Gerät automatisch wieder ab.

Es braucht **keinen** externen Dienst und keine Konfiguration: der Server erzeugt sein
VAPID-Schlüsselpaar beim ersten Start selbst und legt es in der Datenbank ab.

> [!IMPORTANT]
> Das Schlüsselpaar liegt in `pb_data`. Wird die Datenbank neu aufgesetzt, entsteht ein
> neues Paar und **alle vorhandenen Abos werden ungültig**. Die App merkt das beim
> nächsten Öffnen der Profilseite und zeigt „ausgeschaltet“ an; einmal neu einschalten,
> dann läuft es wieder.

Technisch: Web Push nach RFC 8291/8292, verschickt aus einem PocketBase-Hook
(`pb/pb_hooks/`). Die Krypto ist ein gebündeltes Modul, das mit `./build.sh` bzw.
`npm run build:hooks` neu erzeugt wird; `npm run test:hooks` prüft sie gegen den
Testvektor aus dem RFC.

---

## Frontend-Aufbau

```
frontend/src/
├── app.html                   # PWA-Metas: manifest, apple-touch-icon, viewport-fit
├── app.css                    # Tailwind-Entry, Design-Tokens hell/dunkel
├── service-worker.js          # Pass-through-fetch + push / notificationclick
├── lib/
│   ├── pocketbase.svelte.js   # PB-Client, reaktiver authStore-Spiegel, Profil
│   ├── households.svelte.js   # eigene Haushalte, aktiver Haushalt, Mitglieder
│   ├── items.svelte.js        # Liste + Realtime
│   ├── categories.svelte.js   # Kategorien des aktiven Haushalts + Realtime
│   ├── gundula.svelte.js      # Standort des Autos + Realtime
│   ├── expenses.svelte.js     # Ausgaben + Realtime, Cent-Aufteilung
│   ├── wishes.svelte.js       # Wünsche der anderen + eigener Zähler
│   ├── ideas.svelte.js        # Ideen-Feed + Realtime
│   ├── training.svelte.js     # Trainings, Übungen, Gewichte
│   ├── push.svelte.js         # Benachrichtigungen an-/abmelden
│   ├── easteregg.svelte.js    # Osterei
│   ├── components/ui/         # shadcn-svelte (CLI-Output, nicht von Hand pflegen)
│   ├── Dragon.svelte          # Pixeldrache
│   └── Nav.svelte             # Topbar + Burgermenü
└── routes/
    ├── +layout.js             # ssr = false, prerender = false
    ├── +layout.svelte         # Auth-Guard / Redirects, Rahmen mit Nav
    ├── +page.svelte           # Liste
    ├── items/[id]/            # Detailseite eines Eintrags
    ├── gundula/  ausgaben/  wuensche/  ideen/  residents/  haushalte/
    ├── training/              # Gewichte eintragen; einstellungen/ = Plan
    ├── einstellungen/         # Kategorien + Autoname (Haupt-Mitglieder)
    ├── profile/
    └── login/
```

### Realtime

Jeder Store (`items`, `categories`, `expenses`, …) hält seinen State und verwaltet die
Subscription. Wichtig: es werden **immer nur einzelne Records** mutiert (`push` /
`splice` / `items[i] = …`), nie die Liste als Ganzes ersetzt. Dadurch kollidieren
gleichzeitige Änderungen zweier Personen nicht.

Abhaken und Löschen sind optimistisch: erst lokal, dann Server. Schlägt der Request
fehl, wird der vorherige Zustand zurückgerollt.

---

## Was getestet wurde

Stand der ersten Version, end-to-end gegen PocketBase 0.40.2, Frontend aus
`pb/pb_public` vom selben Prozess serviert (die API-Rules sind seitdem pro Haushalt
eingeschränkt, die Kategorien eine eigene Collection):

* Migrationen laufen beim Start durch; `items` hat alle Felder.
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

### Benachrichtigungen

* Die Verschlüsselung stimmt **bytegenau** mit dem Testvektor aus RFC 8291 §5 überein –
  in Node wie in PocketBases JS-VM (`npm run test:hooks`).
* Die VAPID-Signatur wird von **Node WebCrypto** geprüft, also von einer anderen
  Implementierung als der, die sie erzeugt. Genau daran hing ein Fehler, den die
  eigene Bibliothek nicht gesehen hat.
* Gegen einen simulierten Push-Dienst: Anlegen eines Eintrags erzeugt genau einen
  Push je fremdem Gerät, der Verfasser bekommt keinen, die Nachricht lässt sich mit
  dem Geräteschlüssel wieder **entschlüsseln** (Umlaute und Emoji inklusive), und ein
  Endpoint, der `410` antwortet, verschwindet danach aus der Datenbank.
* Rechte: ein Abo für einen *fremden* Account anzulegen wird abgelehnt, ein zweiter
  Datensatz mit demselben `endpoint` ebenfalls.
* Gegen den **echten** Dienst (FCM): Chromium abonniert, ein anderer Nutzer legt einen
  Eintrag an, die Meldung „Neu: Spülmaschinentabs / Drogerie · von Bert Test“
  erscheint im Browser.
* Im Service Worker: Push mit Nutzlast zeigt Titel, Text, Tag und Icon; ein Push
  **ohne** Nutzlast zeigt trotzdem eine Ersatzmeldung (`userVisibleOnly` verlangt das).
* Ein-/Ausschalten und Abmelden räumen den Datensatz und das Abo im Browser weg; ein
  Abo, das zu einem alten VAPID-Schlüssel gehört, wird beim Laden erkannt und
  abgemeldet, statt „eingeschaltet“ anzuzeigen.

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

* **`quantity` ist im Schema angelegt und wird in der Liste angezeigt, hat aber noch
  kein Eingabefeld.** Die erste Version hat bewusst nur das eine Feld ganz oben; das
  Feld existiert schon, damit später keine Schema-Migration nötig ist. `note` wird
  inzwischen auf der Detailseite als Beschreibung bearbeitet.

Nicht enthalten (bewusst): mehrere Listen, Vorlagen, Statistiken, Offline-Caching.
