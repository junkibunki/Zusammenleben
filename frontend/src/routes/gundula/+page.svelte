<script>
	import 'leaflet/dist/leaflet.css';
	import XIcon from '@lucide/svelte/icons/x';
	import CarIcon from '@lucide/svelte/icons/car';
	import CrosshairIcon from '@lucide/svelte/icons/crosshair';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { auth } from '$lib/pocketbase.svelte.js';
	import { households, carName, genitive } from '$lib/households.svelte.js';
	import { userLabel, formatWhen } from '$lib/items.svelte.js';
	import {
		gundula,
		syncGundula,
		parkGundula,
		currentPosition,
		hasLocation
	} from '$lib/gundula.svelte.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Button } from '$lib/components/ui/button/index.js';

	// Ohne bekannten Standort auf Deutschland schauen, statt auf 0/0 im Atlantik.
	const FALLBACK_CENTER = [51.1657, 10.4515];
	const FALLBACK_ZOOM = 5;
	const PARKED_ZOOM = 17;

	// bind:this wird in einem $effect gelesen, muss also $state sein -- sonst
	// laeuft der Effekt nie (CLAUDE.md).
	let mapEl = $state(null);

	// Leaflet-Objekte bewusst als gewoehnliche Variablen: sie *steuern* nur, sie
	// werden nicht angezeigt. Als $state haengte jeder Effekt, der sie schreibt,
	// an seinem eigenen Rueckweg.
	let L = null;
	let map = null;
	let carMarker = null;
	let pickMarker = null;
	let centeredFor = ''; // ID des Records, auf den die Karte zuletzt gesprungen ist

	let mapReady = $state(false);
	let pick = $state(null); // auf der Karte gewaehlter Platz, noch nicht gespeichert
	let confirmOpen = $state(false);
	let pending = $state(null); // { lat, lng, source: 'geo' | 'map' }
	let locating = $state(false);
	let saving = $state(false);
	let error = $state('');
	let attempt = $state(0); // erhoeht "Erneut laden", startet den Ladeeffekt neu

	const record = $derived(gundula.record);
	const parked = $derived(hasLocation(record));
	const parkedBy = $derived(userLabel(record?.expand?.parked_by));
	// Jeder Haushalt nennt sein Auto anders (`households.car_name`).
	const car = $derived(carName());
	const cars = $derived(genitive(car));

	// Laden + Realtime. Liest nichts von dem, was sein eigener Rueckweg schreibt.
	$effect(() => {
		attempt;
		const household = households.activeId;
		if (!auth.valid || !household) return; // der Guard im Layout leitet im selben Tick um
		return syncGundula(household);
	});

	// Karte aufbauen. Leaflet greift schon beim Import auf `document` zu, taugt
	// also nur im Browser -- und muss nicht in den Startchunk der App.
	$effect(() => {
		const el = mapEl;
		if (!el) return;

		let disposed = false;
		let observer = null;

		import('leaflet').then((mod) => {
			if (disposed) return;
			// Der npm-Build ist ESM und setzt *kein* window.L -- die Referenz muss
			// von hier kommen.
			L = mod.default ?? mod;

			map = L.map(el, { zoomControl: true, attributionControl: true }).setView(
				FALLBACK_CENTER,
				FALLBACK_ZOOM
			);

			L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
				maxZoom: 19,
				attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
			}).addTo(map);

			// Tippen auf die Karte waehlt einen Platz. Leaflet unterdrueckt das
			// Click-Event nach einem Schwenk selbst.
			map.on('click', (e) => {
				pick = { lat: e.latlng.lat, lng: e.latlng.lng };
			});

			// Im flex-Layout ist der Container beim ersten Aufbau noch 0 hoch; ohne
			// invalidateSize bleiben graue Kacheln stehen.
			observer = new ResizeObserver(() => map?.invalidateSize());
			observer.observe(el);

			mapReady = true;
		});

		return () => {
			disposed = true;
			observer?.disconnect();
			map?.remove();
			map = null;
			carMarker = null;
			pickMarker = null;
			mapReady = false;
		};
	});

	// Gundulas Pin nachziehen -- auch wenn jemand anders parkt (Realtime).
	$effect(() => {
		if (!mapReady || !map) return;
		const rec = record;

		if (!hasLocation(rec)) {
			carMarker?.remove();
			carMarker = null;
			return;
		}

		const pos = [rec.lat, rec.lng];
		if (carMarker) {
			carMarker.setLatLng(pos);
		} else {
			carMarker = pinMarker(pos, 'car', `${car} steht hier`).addTo(map);
		}

		// Nur einmal hinschauen: wer gerade selbst auf der Karte sucht, will nicht
		// weggeschoben werden, wenn im Hintergrund ein Realtime-Event kommt. Nach
		// einem Wechsel des Haushalts ist es aber ein anderes Auto.
		if (centeredFor !== rec.id) {
			centeredFor = rec.id;
			map.setView(pos, PARKED_ZOOM);
		}
	});

	// Der noch nicht gespeicherte Vorschlag.
	$effect(() => {
		if (!mapReady || !map) return;
		const spot = pick;

		if (!spot) {
			pickMarker?.remove();
			pickMarker = null;
			return;
		}

		const pos = [spot.lat, spot.lng];
		if (pickMarker) pickMarker.setLatLng(pos);
		else pickMarker = pinMarker(pos, 'pick', 'Vorgeschlagener Platz').addTo(map);
	});

	/** Pin als divIcon -- so braucht Leaflet keine Bilddateien aus dem Bundle. */
	function pinMarker(pos, kind, title) {
		const icon = L.divIcon({
			className: `pin pin-${kind}`,
			iconSize: [34, 44],
			iconAnchor: [17, 43],
			html: `<svg viewBox="0 0 34 44" width="34" height="44" aria-hidden="true">
				<path d="M17 42C17 42 32 25.6 32 16A15 15 0 1 0 2 16C2 25.6 17 42 17 42Z"/>
				<circle cx="17" cy="16" r="5.5"/>
			</svg>`
		});
		return L.marker(pos, { icon, title, keyboard: false });
	}

	/** Koordinaten deutsch: Komma als Dezimaltrennzeichen, Schrägstrich dazwischen. */
	function formatCoords(spot) {
		if (!spot) return '';
		const lat = spot.lat.toFixed(5).replace('.', ',');
		const lng = spot.lng.toFixed(5).replace('.', ',');
		return `${lat} / ${lng}`;
	}

	function askToPark() {
		error = '';

		// Ein Tipp auf die Karte hat Vorrang: wer einen Platz gewaehlt hat, meint
		// den -- nicht den, an dem das Handy gerade liegt.
		if (pick) {
			pending = { ...pick, source: 'map' };
			confirmOpen = true;
			return;
		}

		locating = true;
		currentPosition()
			.then((pos) => {
				pick = pos;
				map?.setView([pos.lat, pos.lng], PARKED_ZOOM);
				pending = { ...pos, source: 'geo' };
				confirmOpen = true;
			})
			.catch((err) => {
				error = err?.message ?? 'Der Standort ist nicht zu ermitteln.';
			})
			.finally(() => {
				locating = false;
			});
	}

	async function park() {
		const spot = pending;
		if (!spot) return;

		// Selbst schliessen: `AlertDialog.Action` schliesst *nicht* von allein,
		// sobald ein eigenes onclick daran haengt -- nachgemessen, der Dialog blieb
		// mit `data-state="open"` stehen, obwohl gespeichert war.
		confirmOpen = false;
		saving = true;
		try {
			await parkGundula(spot.lat, spot.lng);
			pick = null;
			pending = null;
			map?.setView([spot.lat, spot.lng], Math.max(map.getZoom(), PARKED_ZOOM));
		} catch (err) {
			// PocketBase antwortet englisch; der eigentliche Grund steht im Feldfehler.
			const detail = err?.response?.data;
			const field = detail && Object.values(detail)[0]?.message;
			error = field ? `Speichern fehlgeschlagen: ${field}` : 'Speichern fehlgeschlagen.';
		} finally {
			saving = false;
		}
	}

	function recenter() {
		if (!map || !hasLocation(record)) return;
		map.setView([record.lat, record.lng], Math.max(map.getZoom(), PARKED_ZOOM));
	}
</script>

{#if error}
	<div class="px-3 pt-3">
		<Alert.Root variant="destructive">
			<Alert.Description>{error}</Alert.Description>
			<Alert.Action>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Meldung schließen"
					onclick={() => (error = '')}
				>
					<XIcon class="size-4" />
				</Button>
			</Alert.Action>
		</Alert.Root>
	</div>
{/if}

<main class="flex min-h-0 flex-1 flex-col gap-3 px-3 pt-3 pb-3">
	<!-- `isolate` ist hier nicht Kosmetik: Leaflet vergibt seinen Panes und
	     Controls z-index bis 1000. Ohne eigenen Stacking-Context liegen die im
	     Kontext des <body> und damit *ueber* dem Bestaetigungsdialog (z-50). -->
	<div class="bg-muted relative isolate min-h-64 flex-1 overflow-hidden rounded-lg border">
		<!-- `absolute inset-0`, nicht `h-full`: die Hoehe des Rahmens kommt aus dem
		     flex-Layout (`flex-1`), seine *angegebene* Hoehe bleibt `auto` -- und
		     ein `height: 100%` dagegen loest zu 0 auf. Gemessen: Rahmen 639px,
		     Karte 0px, nur die Zoom-Knoepfe standen im Leeren. -->
		<div
			bind:this={mapEl}
			role="application"
			aria-label="Karte mit {cars} Standort. Tippen wählt einen Platz."
			class="absolute inset-0"
		></div>

		{#if parked}
			<Button
				variant="secondary"
				size="icon-lg"
				class="absolute top-2 right-2 z-[1100] size-11 shadow"
				aria-label="Karte auf {car} zentrieren"
				onclick={recenter}
			>
				<CrosshairIcon class="size-5" />
			</Button>
		{/if}
	</div>

	<div class="flex flex-col gap-2">
		{#if gundula.loading}
			<p class="text-muted-foreground text-sm">Lade …</p>
		{:else if gundula.error}
			<div class="flex items-center gap-2">
				<p class="text-muted-foreground flex-1 text-sm">Der Standort ist nicht angekommen.</p>
				<Button variant="outline" size="lg" class="h-11" onclick={() => attempt++}>
					<RefreshCwIcon class="size-4" />
					Erneut laden
				</Button>
			</div>
		{:else if parked}
			<p class="text-sm">
				Geparkt von <span class="font-medium">{parkedBy || 'jemandem'}</span>,
				{formatWhen(record.parked_at)}
			</p>
		{:else}
			<p class="text-sm">{cars} Standort ist noch nicht gesetzt.</p>
		{/if}

		{#if pick}
			<div class="flex items-center gap-2">
				<p class="text-muted-foreground flex-1 text-xs">
					Gewählter Platz (blau): {formatCoords(pick)}
				</p>
				<Button variant="ghost" size="lg" class="h-11" onclick={() => (pick = null)}>
					Verwerfen
				</Button>
			</div>
		{:else}
			<p class="text-muted-foreground text-xs">
				Tippe auf die Karte, um den Platz von Hand zu wählen — oder nimm gleich deinen eigenen
				Standort.
			</p>
		{/if}

		<Button size="lg" class="h-11 w-full" disabled={locating || saving} onclick={askToPark}>
			<CarIcon class="size-4" />
			{locating ? 'Standort wird ermittelt …' : `${car} hier parken`}
		</Button>
	</div>
</main>

<AlertDialog.Root bind:open={confirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{car} hier parken?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if pending?.source === 'geo'}
					{cars} Standort wird für alle auf deinen aktuellen Standort gesetzt.
				{:else}
					{cars} Standort wird für alle auf den gewählten Platz gesetzt.
				{/if}
				{#if parked}
					Der bisherige Standort geht dabei verloren.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>

		<p class="text-muted-foreground text-xs">{formatCoords(pending)}</p>

		<AlertDialog.Footer>
			<AlertDialog.Cancel class="h-11">Abbrechen</AlertDialog.Cancel>
			<AlertDialog.Action class="h-11" onclick={park}>Ja, hier parken</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<style>
	/* Leaflet baut seine Elemente selbst in den Container -- Sveltes gescopte
	   Selektoren treffen sie nicht, also :global. */
	:global(.leaflet-container) {
		background: var(--muted);
		font: inherit;
	}

	/* Der divIcon-Standard bringt weissen Kasten und Rahmen mit; ein eigener
	   className ersetzt zwar `leaflet-div-icon`, aber sicher ist sicher. */
	:global(.pin) {
		background: none;
		border: 0;
	}

	/* Bewusst festes Rot bzw. Blau statt der Design-Tokens: die Pins liegen auf
	   OSM-Kacheln, nicht auf dem App-Hintergrund -- `--primary` waere im
	   Dunkelmodus fast weiss und auf der hellen Karte unsichtbar. */
	:global(.pin svg path) {
		fill: #dc2626;
		stroke: #ffffff;
		stroke-width: 2.5;
	}

	:global(.pin svg circle) {
		fill: #ffffff;
	}

	:global(.pin-pick svg path) {
		fill: #2563eb;
	}

	/* 44px Tap-Targets. Die nackte Klasse verliert gegen Leaflets eigenes
	   `.leaflet-touch .leaflet-bar a` (hoehere Spezifitaet), also beide Wege. */
	:global(.leaflet-bar a),
	:global(.leaflet-touch .leaflet-bar a) {
		width: 44px;
		height: 44px;
		line-height: 44px;
		font-size: 1.25rem;
	}

	/* Eine gleissend weisse Karte in einer fast schwarzen App ist unangenehm.
	   Nur die Kacheln daempfen -- Pins, Zoom und Attribution bleiben, wie sie
	   sind, damit die Quellenangabe lesbar bleibt. */
	@media (prefers-color-scheme: dark) {
		:global(.leaflet-tile-pane) {
			filter: brightness(0.85) saturate(0.9);
		}
	}
</style>
