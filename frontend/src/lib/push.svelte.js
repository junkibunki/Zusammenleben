import { browser, dev } from '$app/environment';
import { pb } from './pocketbase.svelte.js';

// Web Push aus Sicht des Browsers: Erlaubnis holen, Abo anlegen, Abo beim
// Server hinterlegen. Verschickt wird serverseitig (pb/pb_hooks/push.pb.js).

export const push = $state({
	supported: false, // Browser kann Web Push ueberhaupt
	permission: 'default', // 'default' | 'granted' | 'denied'
	enabled: false, // dieses Geraet bekommt Benachrichtigungen
	busy: false,
	error: null
});

/** base64url (so kommt der VAPID-Schluessel) -> Bytes fuer subscribe(). */
function keyToBytes(text) {
	const base64 = String(text).replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
	const out = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}

/** "Chrome auf Android" -- nur zur Anzeige, nie zum Filtern. */
function deviceLabel() {
	const ua = navigator.userAgent;
	const os = /iPhone|iPad|iPod/.test(ua)
		? 'iPhone'
		: /Android/.test(ua)
			? 'Android'
			: /Macintosh/.test(ua)
				? 'Mac'
				: /Windows/.test(ua)
					? 'Windows'
					: '';
	// Reihenfolge zaehlt: Edge nennt sich auch Chrome, Chrome auch Safari.
	const app = /Edg\//.test(ua)
		? 'Edge'
		: /Chrome\//.test(ua)
			? 'Chrome'
			: /Firefox\//.test(ua)
				? 'Firefox'
				: /Safari\//.test(ua)
					? 'Safari'
					: '';
	return [app, os].filter(Boolean).join(' auf ') || 'Unbekanntes Gerät';
}

/**
 * Die Service-Worker-Registrierung.
 * Im Produktionsbuild registriert SvelteKit den Worker selbst; im Dev-Modus
 * nicht -- dort wuerde `ready` fuer immer warten, statt zu scheitern.
 */
async function registration() {
	if (dev) await navigator.serviceWorker.register('/service-worker.js', { type: 'module' });
	return navigator.serviceWorker.ready;
}

/** Lesbare Meldung aus einem PocketBase- oder DOM-Fehler. */
function reason(err) {
	const data = err?.response?.data ?? {};
	const first = Object.values(data).find((v) => v?.message);
	if (first?.message) return first.message;
	if (err?.name === 'NotAllowedError') return 'Der Browser hat Benachrichtigungen nicht erlaubt.';
	return err?.message ?? 'Unbekannter Fehler';
}

/** Das Abo dieses Geraets, wie es in `push_subscriptions` steht (oder null). */
async function findRecord(endpoint) {
	try {
		return await pb
			.collection('push_subscriptions')
			.getFirstListItem(pb.filter('endpoint = {:endpoint}', { endpoint }));
	} catch {
		return null; // 404 = noch nicht hinterlegt
	}
}

/**
 * Legt das Abo beim Server ab bzw. bringt es auf Stand.
 * Der Endpoint hat einen Unique-Index, ein zweites Anlegen scheitert also --
 * deshalb erst suchen, dann aktualisieren.
 */
async function storeSubscription(subscription) {
	const me = pb.authStore.record;
	if (!me) throw new Error('Nicht angemeldet');

	const keys = subscription.toJSON().keys ?? {};
	const data = {
		user: me.id,
		endpoint: subscription.endpoint,
		p256dh: keys.p256dh ?? '',
		auth: keys.auth ?? '',
		device: deviceLabel()
	};

	const existing = await findRecord(subscription.endpoint);
	if (existing) await pb.collection('push_subscriptions').update(existing.id, data);
	else await pb.collection('push_subscriptions').create(data);
}

/**
 * Gehoert ein vorhandenes Abo noch zum aktuellen VAPID-Schluessel?
 * Nach einem Reset der Datenbank erzeugt der Server ein neues Paar; das alte
 * Abo bleibt im Browser bestehen, wuerde aber nur noch 403 einbringen.
 */
function matchesKey(subscription, expected) {
	const actual = subscription.options?.applicationServerKey;
	if (!actual) return true; // Browser gibt die Option nicht her -- nicht raten
	const bytes = new Uint8Array(actual);
	if (bytes.length !== expected.length) return false;
	return bytes.every((b, i) => b === expected[i]);
}

/**
 * Liest den tatsaechlichen Zustand aus Browser und Server.
 * Bewusst ohne jeden Lesezugriff auf `push`: die Funktion laeuft aus einem
 * $effect, und was ein Effekt liest, darf sein eigener Ablauf nicht schreiben.
 */
export async function refreshPush() {
	const supported =
		browser &&
		'serviceWorker' in navigator &&
		'PushManager' in window &&
		'Notification' in window;

	push.supported = supported;
	if (!supported) return;

	const permission = Notification.permission;
	push.permission = permission;

	if (permission !== 'granted') {
		push.enabled = false;
		return;
	}

	try {
		const reg = await registration();
		const subscription = await reg.pushManager.getSubscription();
		if (!subscription) {
			push.enabled = false;
			return;
		}

		// Gehoert das Abo noch zum aktuellen VAPID-Schluessel? Nach einem Reset
		// der Datenbank erzeugt der Server ein neues Paar; das alte Abo bringt
		// dann nur noch 403 ein, wuerde hier aber weiter als "eingeschaltet"
		// stehen. Dann lieber abmelden und neu einschalten lassen.
		const { publicKey } = await pb.send('/api/push/key', { method: 'GET' });
		if (!matchesKey(subscription, keyToBytes(publicKey))) {
			await subscription.unsubscribe();
			push.enabled = false;
			return;
		}

		// Selbstheilung: der Browser hat noch ein Abo, der Server aber nicht
		// (z.B. weil pb_data neu ist). Ohne das kaeme nie wieder eine
		// Benachrichtigung an, ohne dass es irgendwo auffaellt.
		await storeSubscription(subscription);
		push.enabled = true;
	} catch (err) {
		push.error = reason(err);
	}
}

/** Benachrichtigungen auf diesem Geraet einschalten. Braucht eine Nutzeraktion. */
export async function enablePush() {
	push.busy = true;
	push.error = null;

	try {
		// Nur aus einem Klick heraus erlaubt -- sonst lehnen die Browser ab.
		const permission = await Notification.requestPermission();
		push.permission = permission;
		if (permission !== 'granted') {
			push.error =
				permission === 'denied'
					? 'Benachrichtigungen sind für diese Seite blockiert. Das lässt sich nur in den Browser-Einstellungen ändern.'
					: 'Der Browser hat Benachrichtigungen nicht erlaubt.';
			return;
		}

		const reg = await registration();
		const { publicKey } = await pb.send('/api/push/key', { method: 'GET' });
		const applicationServerKey = keyToBytes(publicKey);

		let subscription = await reg.pushManager.getSubscription();
		if (subscription && !matchesKey(subscription, applicationServerKey)) {
			await subscription.unsubscribe();
			subscription = null;
		}
		if (!subscription) {
			subscription = await reg.pushManager.subscribe({
				// Pflicht: jede Push-Nachricht muss eine sichtbare Meldung ergeben.
				userVisibleOnly: true,
				applicationServerKey
			});
		}

		await storeSubscription(subscription);
		push.enabled = true;
	} catch (err) {
		push.error = reason(err);
	} finally {
		push.busy = false;
	}
}

/**
 * Meldet dieses Geraet ab: erst der Eintrag beim Server, dann das Abo im
 * Browser. Andere Geraete derselben Person bleiben angemeldet.
 */
export async function disablePush() {
	push.busy = true;
	push.error = null;

	try {
		const reg = await registration();
		const subscription = await reg.pushManager.getSubscription();
		if (subscription) {
			const existing = await findRecord(subscription.endpoint);
			if (existing) await pb.collection('push_subscriptions').delete(existing.id);
			await subscription.unsubscribe();
		}
		push.enabled = false;
	} catch (err) {
		push.error = reason(err);
	} finally {
		push.busy = false;
	}
}

/** Probebenachrichtigung an die eigenen Geraete; liefert {subscriptions, sent}. */
export async function sendTestPush() {
	push.busy = true;
	push.error = null;
	try {
		return await pb.send('/api/push/test', { method: 'POST' });
	} catch (err) {
		push.error = reason(err);
		return null;
	} finally {
		push.busy = false;
	}
}

/**
 * Beim Abmelden aufzurufen, *bevor* das Token weg ist.
 * Ohne das bekaeme ein abgemeldetes Geraet weiter jede neue Zeile der Liste
 * angezeigt: das Abo im Browser bleibt gueltig, der Eintrag beim Server auch.
 */
export async function unsubscribeThisDevice() {
	if (!browser || !('serviceWorker' in navigator)) return;

	const reg = await navigator.serviceWorker.getRegistration();
	const subscription = await reg?.pushManager.getSubscription();
	if (!subscription) return;

	const existing = await findRecord(subscription.endpoint);
	if (existing) await pb.collection('push_subscriptions').delete(existing.id);
	await subscription.unsubscribe();
	push.enabled = false;
}
