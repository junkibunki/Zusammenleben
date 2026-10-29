# Server und Netz (STRATO-VPS, Caddy)

Lesen, bevor du einer langsamen Produktivumgebung mit Code-Optimierung beikommen willst
oder am Caddyfile bzw. der STRATO-Firewall drehst.

## Aufbau

Vor PocketBase steht **Caddy** (`/etc/caddy/Caddyfile`, Block `gruenerfreund.de`, Proxy
auf `127.0.0.1:8090`). Erkennbar am Antwort-Header `Via: 1.1 Caddy`. Auf demselben Server
läuft eine zweite Site (`bamla.ch`). Kompression und Cache-Header gehören deshalb ins
Caddyfile, nicht in `pb_hooks`.

## Lange Ladezeiten, obwohl der Server schnell antwortet

**Symptom:** Die App lädt zäh, `curl -4` bekommt die Antwort in ~30 ms, aber ohne
`-4` braucht der Verbindungsaufbau (`time_connect`) ~250 ms. Und `curl -6` läuft auf jedem
Port ins Timeout.
**Ursache:** Die Domain hat einen AAAA-Eintrag, aber die STRATO-Firewall (Panel) ließ
eingehendes IPv6 nicht durch. Jeder Browser versucht IPv6 zuerst und weicht erst nach
~300 ms auf IPv4 aus, und zwar bei *jeder neuen Verbindung*. Auf dem Server selbst sieht
alles gesund aus: Caddy lauscht auf `*:443`, `ip6tables` steht auf `ACCEPT`, `ping -6`
nach draußen geht.
**Lösung:** In der STRATO-Firewall eingehende IPv6-Regeln anlegen (TCP 80, TCP 443,
UDP 443, Quelle `::/0`). Das Übernehmen dauert ein paar Minuten. Prüfen von außen:
`curl -6 -s -o /dev/null -w "%{http_code} %{time_connect}\n" https://gruenerfreund.de/api/health`.
Notausgang: den AAAA-Eintrag löschen.

## Einzelne Listen brauchen Sekunden

**Symptom:** Verbindung schnell, JS schnell, aber Liste oder Feed hängen 3–6 s. Im
Browser `performance.getEntriesByType('resource')` ansehen: ein einzelner `/api/…`-Request
mit großem `responseStart - requestStart`. Denselben Request mit und ohne `expand`
wiederholen. Ist nur die Variante mit `expand` langsam, ist es die ViewRule der
Zielcollection, siehe [migrationen.md](migrationen.md#api-rules).
