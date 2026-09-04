/// <reference types="@sveltejs/kit" />

// Bewusst ohne Caching und ohne Offline-Modus. Der Worker existiert aus zwei
// Gruenden: damit Chrome/Edge die App als installierbar erkennen ("Zum
// Startbildschirm" statt Lesezeichen) -- dafuer ist ein registrierter Worker MIT
// fetch-Handler Pflicht -- und weil Web Push nur hier ankommt.

self.addEventListener('install', () => {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;
	event.respondWith(fetch(event.request));
});

// Eine neue Zeile auf dem Einkaufszettel. Die Nutzdaten kommen verschluesselt
// vom Server (pb/pb_hooks/push.pb.js) und stehen hier als JSON bereit.
self.addEventListener('push', (event) => {
	let data = {};
	try {
		data = event.data ? event.data.json() : {};
	} catch {
		// Push ohne oder mit fremder Nutzlast -- unten steht ein Ersatztext.
	}

	// Angezeigt werden *muss* etwas: das Abo laeuft mit userVisibleOnly, und
	// stumme Pushes entzieht der Browser sonst irgendwann ganz.
	const title = data.title || 'Familien-Einkauf';

	event.waitUntil(
		self.registration.showNotification(title, {
			body: data.body || 'Es gibt etwas Neues auf dem Einkaufszettel.',
			icon: '/icon-192.png',
			// Ein Tag pro Eintrag: zwei neue Sachen ergeben zwei Meldungen, eine
			// Wiederholung desselben Pushes ersetzt die vorhandene.
			tag: data.tag,
			data: { url: data.url || '/' }
		})
	);
});

// Antippen soll die schon offene App nach vorn holen, nicht ein zweites
// Fenster aufmachen.
self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const target = new URL(event.notification.data?.url || '/', self.location.origin);

	event.waitUntil(
		(async () => {
			const clients = await self.clients.matchAll({
				type: 'window',
				includeUncontrolled: true
			});

			for (const client of clients) {
				if (new URL(client.url).pathname === target.pathname) return client.focus();
			}
			if (clients.length > 0) {
				// Vorhandenes Fenster umleiten; navigate() ist nicht ueberall da.
				const client = clients[0];
				await client.navigate?.(target.href);
				return client.focus();
			}
			return self.clients.openWindow(target.href);
		})()
	);
});
