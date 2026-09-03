/// <reference types="@sveltejs/kit" />

// Bewusst trivial: kein Caching, kein Offline-Modus.
// Der Service Worker existiert nur, damit Chrome/Edge die App als
// installierbar erkennen ("Zum Startbildschirm" statt Lesezeichen) --
// dafuer ist ein registrierter Worker MIT fetch-Handler Pflicht.

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
