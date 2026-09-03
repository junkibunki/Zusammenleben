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

export function logout() {
	pb.authStore.clear();
}
