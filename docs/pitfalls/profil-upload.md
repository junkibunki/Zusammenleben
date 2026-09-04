# Profil / Dateiupload

Lesen, bevor du am Avatar, an `profile/+page.svelte` oder an einem Dateifeld arbeitest.

**`?thumb=WxH` funktioniert nur für Größen, die im Feld unter `thumbs` stehen.** Symptom:
die URL liefert 200 und ein gültiges Bild — nur eben das Original in voller Größe. Kein
Fehler, kein Log. PocketBase fällt bei einer nicht registrierten Größe still zurück
(nachgemessen: `?thumb=200x200` → 5,6 KB, `?thumb=33x33` → 7,9 KB = Originaldatei).
Deshalb Migration `1756000003`; `avatarUrl()` in `pocketbase.svelte.js` muss dieselbe
Größe verwenden.

**Upload per `FormData`**, nicht als JSON-Objekt; `data.append('avatar', '')` löscht die
Datei.

**Handyfotos vor dem Upload verkleinern.** Das `avatar`-Feld hat `maxSize: 0`, das ist
PocketBase-Default = 5 MB; ein Foto darüber wird abgelehnt. `profile/+page.svelte`
skaliert per Canvas auf 512px (5,8-MB-PNG → 7,9-KB-JPEG). Dabei zwei Fallen: **JPEG kennt
kein Alpha**, also vor `drawImage` weiß füllen, sonst wird jede transparente Fläche
schwarz — und **ist das Bild schon klein genug, gar nicht neu codieren**, sonst verliert
ein PNG-Logo seine Transparenz ohne Grund.

**PocketBase sagt bei einem abgelehnten Upload nur „Failed to update record."** Der echte
Grund (falscher MIME-Typ, zu groß) steht in `err.response.data.<feld>.message`. Ohne
Auswertung sieht der Nutzer einen englischen Satz ohne Information.

**Das `avatar`-Feld ist `protected: false`:** die Datei-URL ist ohne Token abrufbar,
geschützt nur durch den zufälligen Dateinamen. Bewusst so — für eine Familienliste reicht
das, und Bilder liegen so im Browser-Cache. Wer das enger will: `protected: true` plus
`pb.files.getToken()`.

**Bekannte Grenze:** eine Namensänderung wirkt nicht auf bereits geladene Listenzeilen —
die zeigen `item.expand.added_by.name` aus dem Cache. Beim nächsten Betreten der Liste
(`syncItems()` lädt neu) steht der neue Name da.
