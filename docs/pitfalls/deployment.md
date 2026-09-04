# Deployment (GitHub Actions → STRATO-VPS)

Lesen, bevor du `.github/workflows/deploy.yml` änderst oder einem grünen Deploy glaubst.

## Der Deploy läuft, aber nichts ändert sich

Symptom: Workflow grün, App zeigt den alten Stand. Ursache: `TARGET` im Workflow ≠
`WorkingDirectory` der systemd-Unit — PocketBase sucht `pb_public/`, `pb_migrations/` und
`pb_data/` relativ dazu. Prüfen mit `systemctl show pocketbase -p WorkingDirectory`.

**„Noch keine Datenbank vorhanden" im Deploy-Log ist ein Warnsignal, kein Hinweis.** Nach
dem ersten erfolgreichen Deploy darf die Zeile nicht mehr auftauchen. Tut sie es doch,
schreibt der Deploy in ein Verzeichnis, in dem PocketBase noch nie gelaufen ist — also am
Dienst vorbei oder auf einen Server ohne Installation.

## Reihenfolge und Fehlerbehandlung

* **`cp: cannot stat '<TARGET>/pb_data'` beim ersten Deploy.** `pb_data/` entsteht erst
  beim ersten PocketBase-Start, existiert auf einem frischen Server also nicht. Scheitert
  das Backup-Kommando unter `set -e` daran, *nachdem* der Dienst gestoppt wurde, bleibt
  der Server gestoppt zurück. Deshalb: Sicherung nur `if [ -d … ]`, und ein
  `trap '… systemctl start …' EXIT` über den ganzen kritischen Abschnitt.
* **Beim Umschwenken erst das Neue reinlegen, dann das Alte löschen.**
  `rm -rf pb_public && mv .deploy/pb_public pb_public` lässt bei einem gescheiterten `mv`
  einen laufenden Dienst ganz ohne Frontend zurück.
* **`set -e` bricht bei `[ "$(id -u)" -ne 0 ] && SUDO="sudo"` *nicht* ab**, auch wenn der
  Test fehlschlägt: errexit gilt nicht für Kommandos in einer `&&`-Liste außer dem
  letzten. Das Idiom ist also sicher.

## `status=203/EXEC` heißt nicht, dass PocketBase abgestürzt ist

Symptom: der Healthcheck läuft in lauter `curl: (7) Failed to connect`, `systemctl status`
zeigt `Active: activating (auto-restart)` und `code=exited, status=203/EXEC`. Ursache:
systemd konnte die Datei aus `ExecStart` gar nicht erst ausführen — sie fehlt, hat kein
Exec-Bit oder ist der falsche Build (Windows-`.exe`, falsche Architektur). Von PocketBase
steht deshalb nichts im Log (der Prozess ist nie angelaufen); die Ursache loggt systemd
selbst (`journalctl -u pocketbase`: `Failed to locate executable …`, `Failed at step
EXEC`). Das Binary wird bewusst *nicht* mitdeployt, es muss einmalig von Hand auf dem
Server liegen. Prüfen mit `ls -l <TARGET>/pocketbase` und `file <TARGET>/pocketbase`.

## Healthcheck

* **`curl -fsS http://127.0.0.1/api/health` taugt nicht.** Läuft PocketBase mit `--https`,
  antwortet Port 80 mit einem 302; `curl -f` wertet das als Erfolg, ohne die API je
  erreicht zu haben.
* **`-L` reicht nicht, und `-k` hilft nicht.** Symptom: lauter
  `curl: (35) TLS connect error: error:0A000438:SSL routines::tlsv1 alert internal error`,
  während `systemctl status` `active (running)` zeigt und die Seite von außen einwandfrei
  antwortet. Ursache: PocketBase leitet unter Beibehaltung des Host-Headers um, aus
  `http://127.0.0.1/api/health` wird `https://127.0.0.1/api/health`. Zu einer IP schickt
  curl keine SNI, und ohne Servernamen findet PocketBases Autocert kein Zertifikat und
  bricht den Handshake mit einem fatalen Alert ab — **serverseitig, vor jeder
  Zertifikatsprüfung**, deshalb ändert `-k` nichts. Nachstellen von außen:
  `curl -k https://<IP>/api/health` schlägt genauso fehl, `https://<domain>/api/health`
  nicht. Lösung: die Domain anfragen und die Verbindung per
  `--resolve "$DOMAIN:443:127.0.0.1"` auf Loopback zwingen. `-k` bleibt trotzdem stehen —
  geprüft wird, ob die API antwortet, nicht ob die Kette hier verifizierbar ist.
* **`systemctl is-active` sagt bei `Type=simple` nichts aus.** Die Unit ist „active",
  sobald der Prozess geforkt ist — eine gescheiterte Migration sieht man daran nicht.
