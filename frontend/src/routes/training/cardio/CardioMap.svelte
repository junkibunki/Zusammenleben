<script>
	import 'leaflet/dist/leaflet.css';

	// Strecke als Linie auf OSM-Kacheln. `live`: folgt dem letzten Punkt, statt
	// einmal auf die ganze Strecke zu zoomen. `points` ist bei der laufenden
	// Aufzeichnung dasselbe, wachsende Array -- neu gezeichnet wird, wenn
	// `version` sich aendert.
	let { points = [], version = 0, live = false } = $props();

	const FALLBACK_CENTER = [51.1657, 10.4515];
	const FALLBACK_ZOOM = 5;
	const LIVE_ZOOM = 16;

	// bind:this wird in einem $effect gelesen, muss also $state sein (CLAUDE.md).
	let mapEl = $state(null);
	let ready = $state(false);

	// Leaflet-Objekte steuern nur -- kein $state, wie auf der Gundula-Seite.
	let L = null;
	let map = null;
	let line = null;
	let startDot = null;
	let endDot = null;
	let centered = false;

	$effect(() => {
		const el = mapEl;
		if (!el) return;
		let disposed = false;
		let observer = null;

		import('leaflet').then((mod) => {
			if (disposed) return;
			// Der npm-Build ist ESM und setzt kein window.L.
			L = mod.default ?? mod;
			map = L.map(el, { zoomControl: true, attributionControl: true }).setView(
				FALLBACK_CENTER,
				FALLBACK_ZOOM
			);
			L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
				maxZoom: 19,
				attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
			}).addTo(map);
			// Feste Farben statt Tokens: die Linie liegt auf den hellen Kacheln.
			line = L.polyline([], { color: '#2563eb', weight: 5, opacity: 0.9 }).addTo(map);
			observer = new ResizeObserver(() => map?.invalidateSize());
			observer.observe(el);
			ready = true;
		});

		return () => {
			disposed = true;
			observer?.disconnect();
			map?.remove();
			map = line = startDot = endDot = null;
			centered = false;
			ready = false;
		};
	});

	function dot(pos, color) {
		return L.circleMarker(pos, {
			radius: 7,
			color: '#ffffff',
			weight: 2.5,
			fillColor: color,
			fillOpacity: 1
		}).addTo(map);
	}

	$effect(() => {
		version;
		const list = points;
		if (!ready || !map) return;

		const latlngs = (Array.isArray(list) ? list : [])
			.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
			.map((p) => [p[0], p[1]]);
		line.setLatLngs(latlngs);

		startDot?.remove();
		endDot?.remove();
		startDot = endDot = null;
		if (latlngs.length === 0) return;
		startDot = dot(latlngs[0], '#16a34a');
		if (latlngs.length > 1 || live) endDot = dot(latlngs.at(-1), live ? '#2563eb' : '#dc2626');

		if (live) {
			if (!centered) map.setView(latlngs.at(-1), LIVE_ZOOM);
			else map.panTo(latlngs.at(-1));
		} else if (!centered) {
			if (latlngs.length > 1) map.fitBounds(line.getBounds(), { padding: [24, 24] });
			else map.setView(latlngs[0], LIVE_ZOOM);
		}
		centered = true;
	});
</script>

<!-- `isolate`: Leaflet vergibt z-index bis 1000; ohne eigenen Stacking-Context
     laege die Karte ueber Dialogen (docs/pitfalls/designsystem.md). -->
<div class="bg-muted relative isolate h-72 overflow-hidden rounded-lg border">
	<div
		bind:this={mapEl}
		role="application"
		aria-label="Karte mit der Strecke"
		class="absolute inset-0"
	></div>
</div>

<style>
	/* Wie auf der Gundula-Seite; deren Styles laden nur mit ihrer Route. */
	:global(.leaflet-container) {
		background: var(--muted);
		font: inherit;
	}

	:global(.leaflet-bar a),
	:global(.leaflet-touch .leaflet-bar a) {
		width: 44px;
		height: 44px;
		line-height: 44px;
		font-size: 1.25rem;
	}

	@media (prefers-color-scheme: dark) {
		:global(.leaflet-tile-pane) {
			filter: brightness(0.85) saturate(0.9);
		}
	}
</style>
