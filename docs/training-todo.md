# Training: To-do für die Erweiterung

Stand 2026-10-18. Grundlage: der jetzige Code (`training.svelte.js`, `routes/training/`,
`pb_hooks/training-lib.js`) und eine Recherche zu Strong, Hevy, JEFIT, FitNotes, Fitbod,
Boostcamp, Gymshark Training und Liftosaur (Vergleichsartikel, Reddit-Zusammenfassungen).

## Was es heute gibt

* Mehrere Trainings (Push/Pull/Beine), je mit Übungen und Soll `Sätze × Wdh.`
* **Ein** Gewicht pro Übung und Tag, „Letztes Mal" mit Datum daneben
* Vorschlag des nächsten Trainings reihum, auch in der Erinnerung
* Push-Erinnerung an gewählten Wochentagen zur gewählten Uhrzeit
* Privat, keine Werbung, kein Feed, keine Bezahlschranke

## Was Nutzer an Trainingsapps loben / hassen

* **Gelobt:** schnelles Eintragen mit wenig Tippen, Werte vom letzten Mal schon
  vorbelegt (Strong, Hevy); Verlauf und Fortschritt pro Übung; Satzpausen-Timer;
  automatische Steigerung (Liftosaur); freier CSV-Export (Strong, Hevy); offline und
  ohne Konto (FitNotes).
* **Gehasst:** Bezahlschranken bei Grundfunktionen, Werbung, Social-Feed, überladene
  Oberfläche (JEFIT), verlorene Trainings (Strong).

→ Was wir schon richtig machen (privat, schlicht, kostenlos), bleibt. Die Lücken liegen
beim Tempo im Studio und bei der Auswertung.

## To-do

Aufwand: **S** = nur Frontend, **M** = Frontend + kleine Migration, **L** = Schema-Umbau.

### P1 – im Studio spürbar

- [x] **Letztes Gewicht übernehmen mit einem Tipp (S).** Heute steht es nur als Platzhalter
      da und muss abgetippt werden. Knopf „wie letztes Mal" pro Übung oder „alle
      übernehmen", dazu `+2,5` / `−2,5` neben dem Feld.
- [x] **Steigerungsvorschlag (S).** Ein dezenter Hinweis „+2,5 kg?", wenn das Gewicht
      mehrmals in Folge gleich geblieben ist. Mit Satz-Logging (unten) wird daraus „alle
      Wdh. geschafft → steigern".
- [x] **Eingaben überleben das Schließen der App (S).** Entwurf pro Tag in `localStorage`;
      eine PWA wird im Studio oft weggewischt oder neu geladen.
- [x] **Satzpausen-Timer (S).** Startet nach einem Tipp, zählt sichtbar herunter,
      vibriert am Ende (`navigator.vibrate`). Die Pausenlänge kann man pro Übung einstellen,
      Standard 90 s.
- [x] **Trainingsdauer (S/M).** Eine Stoppuhr ab „Training starten", die sichtbar
      weiterläuft, auch wenn die App zwischendurch zu war (Startzeit in `localStorage`).
      Soll die Dauer im Verlauf stehen, braucht es ein Feld pro Trainingstag (M).
- [x] **Keine Erinnerung, wenn heute schon trainiert wurde (S, Hook).**
      `sendDueReminders` prüft `training_logs` für `t.date` nicht.

### P2 – Auswertung

- [x] **Verlauf pro Übung (S).** Tippt man auf eine Übung, öffnet sich eine Detailseite mit
      allen Einträgen und einer kleinen Linie über die Zeit.
- [x] **Bestwerte (S).** Eine Markierung „neuer Bestwert", wenn das Gewicht über allem
      Bisherigen liegt, und die Bestwerte der Übung auf der Detailseite.
- [x] **Kalender / Wochenübersicht (S).** Zeigt, an welchen Tagen trainiert wurde und
      wie viele Trainings pro Woche es waren, gemessen an den geplanten Tagen.
- [x] **Verlauf über 1000 Einträge hinaus (S).** `syncTraining` lädt nur
      `getList(1, 1000)`. Für die Eintragsseite reicht das, für den Verlauf nicht: dort pro
      Übung nachladen.
- [x] **CSV-Export (S).** Datum, Training, Übung und Gewicht als Datei. Damit gehören die
      Daten wirklich einem selbst.

### P3 – Modell erweitern

- [x] **Sätze einzeln erfassen (L).** Heute gibt es nur ein Gewicht pro Tag. Neu wären
      pro Satz Gewicht und tatsächliche Wdh., optional ein Aufwärmsatz. Das braucht eine
      neue Collection oder ein JSON-Feld und eine Migration der Altdaten (Gewicht → n gleiche
      Sätze). Erst danach ergeben 1RM-Schätzung und Volumen Sinn.
- [x] **Notiz pro Übung und Tag (M).** „Sitzhöhe 4", „Schulter zwickt".
- [x] **Körpergewicht (M).** Eine eigene kleine Zeitreihe, ebenfalls privat.
- [x] **Übung ohne Gewicht / mit Zeit (M).** Für Klimmzüge, Planks und Cardio: Typ der
      Übung (`kg` | `Wdh.` | `Zeit`).
- [x] **Wdh.-Bereich statt fester Zahl (M).** Etwa 8–12. Die Steigerung greift, sobald die
      Obergrenze erreicht ist (Double Progression).

### Bewusst nicht

* Übungsbibliothek mit Videos, KI-Pläne, Social-Feed, Smartwatch-App: viel Aufwand,
  für eine private Haushalts-App ohne Mehrwert, und genau das, was an JEFIT und Hevy als
  Ballast kritisiert wird.
