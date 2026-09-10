/// <reference path="../pb_data/types.d.ts" />

// `note`: die Beschreibung zu einem Wunsch -- Groesse, Farbe, ein Link, was ihn
// treffsicher macht. Optional; der Wunsch selbst bleibt `text`.
//
// Bewusst *nicht* Teil der Doppelte-Pruefung (wishes.pb.js): dieselbe Sache
// zweimal mit unterschiedlicher Beschreibung ist dieselbe Sache. Waere die
// Beschreibung mit im Vergleich, liesse sich die Sperre mit einem zusaetzlichen
// Wort umgehen -- und genau das soll sie verhindern, weil der Wuenschende seine
// Liste nicht mehr sehen kann.
//
// Laenge wie `items.note` (1756000006): 2000 Zeichen.
const NOTE_MAX = 2000;

migrate(
	(app) => {
		const wishes = app.findCollectionByNameOrId('wishes');
		// `add` ersetzt ein gleichnamiges Feld, statt es zu doppeln -- die
		// Migration ueberlebt also auch ein erneutes Anwenden.
		wishes.fields.add(new TextField({ name: 'note', required: false, max: NOTE_MAX }));
		app.save(wishes);
	},
	(app) => {
		const wishes = app.findCollectionByNameOrId('wishes');
		wishes.fields.removeByName('note');
		app.save(wishes);
	}
);
