import PocketBase from 'pocketbase';

// Relative Basis-URL: in Produktion serviert derselbe PocketBase-Prozess
// API und Frontend; im Dev-Modus proxied Vite /api auf 127.0.0.1:8090.
export const pb = new PocketBase('/');

// Reaktive Spiegelung des authStore (das Token liegt via SDK im localStorage).
export const auth = $state({
	user: pb.authStore.record ?? null,
	valid: pb.authStore.isValid
});

pb.authStore.onChange(() => {
	auth.user = pb.authStore.record ?? null;
	auth.valid = pb.authStore.isValid;
});

export async function login(email, password) {
	await pb.collection('users').authWithPassword(email, password);
}

export async function logout() {
	// Erst das Push-Abo dieses Geraets abmelden -- danach fehlt das Token dafuer,
	// und der Server wuerde einem abgemeldeten Geraet weiter jede neue Zeile der
	// Liste anzeigen. Dynamisch importiert, damit kein Importzyklus entsteht
	// (push.svelte.js braucht `pb` von hier).
	try {
		const { unsubscribeThisDevice } = await import('./push.svelte.js');
		await unsubscribeThisDevice();
	} catch {
		// Abmelden darf daran nicht scheitern.
	}
	pb.authStore.clear();
}

/**
 * URL des Profilfotos, leer wenn keines gesetzt ist.
 * `size` muss eine in der Migration registrierte Thumb-Groesse sein, sonst
 * liefert PocketBase still das Originalbild aus.
 */
export function avatarUrl(user, size = '200x200') {
	if (!user?.avatar) return '';
	return pb.files.getURL(user, user.avatar, size ? { thumb: size } : {});
}

/**
 * Aendert Namen und/oder Profilfoto des angemeldeten Users.
 * `avatar`: eine `File` setzt ein neues Foto, `null` loescht das vorhandene,
 * `undefined` laesst es unangetastet.
 */
export async function updateProfile({ name, avatar } = {}) {
	const me = pb.authStore.record;
	if (!me) throw new Error('Nicht angemeldet');

	// FormData, weil der Upload sonst nicht mitgeht; "" loescht die Datei.
	const data = new FormData();
	if (name !== undefined) data.append('name', name);
	if (avatar instanceof File) data.append('avatar', avatar);
	else if (avatar === null) data.append('avatar', '');

	const record = await pb.collection('users').update(me.id, data);

	// Das SDK aktualisiert den authStore beim Update des eigenen Auth-Records
	// selbst mit; explizit gesetzt bleibt es davon unabhaengig nachvollziehbar.
	pb.authStore.save(pb.authStore.token, record);
	return record;
}

/**
 * Alle Accounts der Familie, aelteste zuerst.
 * Serverseitig wird nur nach `created` sortiert -- nach `name` standen Accounts
 * ohne Namen vorn; die Reihenfolge in der Anzeige entscheidet die Seite anhand
 * des Anzeigenamens. Braucht die ListRule aus Migration 1756000004.
 */
export async function listUsers() {
	return pb.collection('users').getFullList({ sort: 'created' });
}
