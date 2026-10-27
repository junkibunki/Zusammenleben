import { untrack } from 'svelte';
import { pb } from './pocketbase.svelte.js';
import { trainingError } from './training.svelte.js';

// Cardio: Strecke beim Laufen, Radfahren, Gehen aufzeichnen (Migration
// 1790427600). Privat wie der Rest des Trainings.
//
// Im Web gibt es keinen Standort im Hintergrund: gesperrt oder mit der App im
// Hintergrund liefert `watchPosition` nichts mehr (iOS wie Android). Deshalb
// haelt ein Wake Lock den Bildschirm an, und die Seite legt einen schwarzen
// Sperrbildschirm darueber (CardioLock.svelte). War der Bildschirm doch aus,
// ist die Strecke dazwischen Luftlinie -- `cardio.gap` sagt es an.
//
// Die laufende Aufzeichnung steht im localStorage und ueberlebt Neuladen. Sie
// laeuft weiter, wenn man innerhalb der App die Seite wechselt; beendet wird sie
// nur von Hand. Nach Neuladen oder Neustart der App zeichnet sie erst wieder
// auf, wenn die Cardio-Seite offen ist (syncCardio) -- die Luecke wird gemeldet.

export const KINDS = [
	{ id: 'run', label: 'Laufen' },
	{ id: 'bike', label: 'Radfahren' },
	{ id: 'walk', label: 'Gehen' }
];

/** Ungenauere Fixes (m) werden verworfen; drinnen und beim Start sind es oft 50+. */
export const MAX_ACCURACY = 30;
/** Schneller (m/s) ist ein Ausreisser, kein Sprint. */
const MAX_SPEED = { run: 10, bike: 30, walk: 5 };
/** Ab so langer Pause (ms) im Hintergrund wird eine Luecke gemeldet. */
const GAP_MS = 20000;
/** Hoechstens so oft (ms) die Punkte in den localStorage schreiben. */
const PERSIST_MS = 10000;
const KEY = 'training.cardio.';
const LIST_FIELDS = 'id,date,kind,started,duration,distance';

export const cardio = $state({
	/** Laufende oder beendete, noch nicht gespeicherte Aufzeichnung:
	 *  `{ kind, start, stoppedAt, distance, count }` (ms, m), sonst null. */
	run: null,
	/** Genauigkeit des letzten Fixes in m, null = noch keiner. */
	accuracy: null,
	/** Haelt der Wake Lock den Bildschirm an? null = noch unbekannt. */
	awake: null,
	/** Sekunden, die der Bildschirm zuletzt aus war (0 = keine Luecke). */
	gap: 0,
	/** Zaehlt bei jedem neuen Punkt hoch -- die Karte zeichnet dann nach. */
	version: 0,
	now: Date.now(),
	saving: false,
	error: null,
	routes: [],
	loading: true,
	listError: null
});

// Steuerung, kein $state (CLAUDE.md zu $effect-Schleifen). Die Punkte selbst
// auch nicht: tausende Proxys fuer etwas, das nur die Karte liest.
/** `[[lat, lng, s], …]`, s = Sekunden seit dem Start. */
let points = [];
let user = '';
let watchId = null;
let ticker = null;
let persistTimer = null;
let hiddenAt = 0;
let listening = false;

function read(key) {
	try {
		const raw = localStorage.getItem(key);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

function write(key, value) {
	try {
		if (value == null) localStorage.removeItem(key);
		else localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Voll oder privater Modus: dann ueberlebt es eben kein Neuladen.
	}
}

/** Abstand zweier Punkte in m (Haversine). */
export function distanceBetween(lat1, lng1, lat2, lng2) {
	const rad = Math.PI / 180;
	const dLat = (lat2 - lat1) * rad;
	const dLng = (lng2 - lng1) * rad;
	const a =
		Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
	return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const round5 = (v) => Math.round(v * 1e5) / 1e5;

/** Record-ID im Format von PocketBase: 15 Zeichen a-z0-9. */
function newId() {
	const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}

// --- Anzeige ----------------------------------------------------------------

export function kindLabel(kind) {
	return KINDS.find((k) => k.id === kind)?.label ?? kind;
}

/** 850 -> "850 m", 5234 -> "5,23 km" */
export function formatDistance(m) {
	const v = Math.max(0, m ?? 0);
	if (v < 1000) return `${Math.round(v)} m`;
	return `${(v / 1000).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
}

/** Laufen/Gehen: "5:32 /km", Rad: "24,3 km/h"; "–" ohne genug Strecke. */
export function formatPace(kind, m, seconds) {
	if (!m || m < 50 || !seconds) return '–';
	if (kind === 'bike') {
		const kmh = m / 1000 / (seconds / 3600);
		return `${kmh.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km/h`;
	}
	const perKm = Math.round(seconds / (m / 1000));
	if (perKm >= 3600) return '–';
	return `${Math.floor(perKm / 60)}:${String(perKm % 60).padStart(2, '0')} /km`;
}

/** Sekunden seit dem Start (bis zum Stopp). */
export function runElapsed() {
	const r = cardio.run;
	if (!r) return 0;
	return Math.max(0, ((r.stoppedAt || cardio.now) - r.start) / 1000);
}

/** Die Punkte der laufenden Aufzeichnung -- nur lesen, nicht aendern. */
export function livePoints() {
	return points;
}

// --- Speicher ---------------------------------------------------------------

function persist() {
	clearTimeout(persistTimer);
	persistTimer = null;
	if (!user) return;
	write(KEY + user, cardio.run ? { run: $state.snapshot(cardio.run), points } : null);
}

function persistSoon() {
	if (persistTimer) return;
	persistTimer = setTimeout(persist, PERSIST_MS);
}

// --- GPS --------------------------------------------------------------------

function onFix(pos) {
	const run = cardio.run;
	if (!run || run.stoppedAt) return;
	const { latitude: lat, longitude: lng, accuracy } = pos.coords;
	cardio.accuracy = Math.round(accuracy);
	cardio.error = null;
	if (accuracy > MAX_ACCURACY || pos.timestamp < run.start) return;

	const s = Math.round((pos.timestamp - run.start) / 1000);
	const last = points.at(-1);
	let step = 0;
	if (last) {
		step = distanceBetween(last[0], last[1], lat, lng);
		// Stillstand zittert um ein paar Meter; das waere sonst Strecke.
		if (step < Math.max(5, accuracy / 2)) return;
		if (step / Math.max(1, s - last[2]) > MAX_SPEED[run.kind]) return;
	}
	points.push([round5(lat), round5(lng), s]);
	run.distance += step;
	run.count = points.length;
	cardio.version += 1;
	persistSoon();
}

function onGeoError(err) {
	if (err.code === err.PERMISSION_DENIED) {
		cardio.error =
			'Der Zugriff auf den Standort ist blockiert. Erlaube ihn in den Browser-Einstellungen.';
		stopWatch();
	} else if (err.code === err.POSITION_UNAVAILABLE) {
		cardio.error = 'Kein GPS-Signal.';
	}
	// TIMEOUT: einfach weiter warten, watchPosition versucht es selbst erneut.
}

function startWatch() {
	if (watchId !== null) return;
	if (!navigator.geolocation) {
		cardio.error = 'Dieses Gerät kann seinen Standort nicht melden.';
		return;
	}
	watchId = navigator.geolocation.watchPosition(onFix, onGeoError, {
		enableHighAccuracy: true,
		maximumAge: 0,
		timeout: 60000
	});
}

function stopWatch() {
	if (watchId !== null) navigator.geolocation?.clearWatch(watchId);
	watchId = null;
}

// --- Bildschirm wach halten -------------------------------------------------
//
// Wie in training-timer.svelte.js; der Browser gibt die Sperre beim Verlassen
// der Seite selbst frei, onVisibility fordert sie neu an.

let wakeLock = null;
let wakeLockPending = false;

function tracking() {
	return !!cardio.run && !cardio.run.stoppedAt;
}

function keepAwake() {
	if (wakeLock || wakeLockPending || !tracking()) return;
	if (document.visibilityState !== 'visible') return;
	if (!navigator.wakeLock) {
		cardio.awake = false;
		return;
	}
	wakeLockPending = true;
	navigator.wakeLock
		.request('screen')
		.then((lock) => {
			wakeLockPending = false;
			if (!tracking()) return lock.release();
			wakeLock = lock;
			cardio.awake = true;
			lock.addEventListener('release', () => {
				if (wakeLock === lock) wakeLock = null;
			});
		})
		.catch(() => {
			// Abgelehnt, z.B. im Energiesparmodus.
			wakeLockPending = false;
			cardio.awake = false;
		});
}

function letSleep() {
	const lock = wakeLock;
	wakeLock = null;
	lock?.release().catch(() => {});
}

function onVisibility() {
	if (!tracking()) return;
	if (document.visibilityState === 'hidden') {
		hiddenAt = Date.now();
		persist();
		return;
	}
	if (hiddenAt && Date.now() - hiddenAt > GAP_MS) cardio.gap = Math.round((Date.now() - hiddenAt) / 1000);
	hiddenAt = 0;
	cardio.now = Date.now();
	// Nach dem Sperren liefert manche Uhr nichts mehr, bis man neu anmeldet.
	stopWatch();
	startWatch();
	keepAwake();
}

function listen(on) {
	if (on === listening) return;
	listening = on;
	const fn = on ? 'addEventListener' : 'removeEventListener';
	document[fn]('visibilitychange', onVisibility);
	window[fn]('pagehide', persist);
}

/** Aufzeichnen (wieder) aufnehmen: GPS, Wake Lock, Uhr. */
function resume() {
	startWatch();
	keepAwake();
	listen(true);
	ticker ??= setInterval(() => (cardio.now = Date.now()), 1000);
}

/** Alles anhalten, was das Aufzeichnen braucht. */
function halt() {
	stopWatch();
	letSleep();
	listen(false);
	clearInterval(ticker);
	ticker = null;
	hiddenAt = 0;
	cardio.awake = null;
}

// --- Ablauf -----------------------------------------------------------------

/**
 * Laedt die Liste der Strecken und holt eine laufende Aufzeichnung aus dem
 * localStorage zurueck. Aufruf aus einem $effect; das Teardown bricht nur das
 * Laden ab -- die Aufzeichnung laeuft beim Verlassen der Seite weiter.
 */
export function syncCardio(userId) {
	return untrack(() => {
		let cancelled = false;
		if (user !== userId) {
			halt();
			persist();
			user = userId;
			const stored = read(KEY + userId);
			cardio.run = stored?.run ?? null;
			points = Array.isArray(stored?.points) ? stored.points : [];
			cardio.accuracy = null;
			cardio.error = null;
			cardio.version += 1;
			cardio.routes = [];
			cardio.loading = true;
			// Nach Neuladen: lag der letzte Punkt lange zurueck, war die Seite zu.
			const last = points.at(-1);
			if (tracking() && last && Date.now() - (cardio.run.start + last[2] * 1000) > GAP_MS * 3) {
				cardio.gap = Math.round((Date.now() - cardio.run.start) / 1000 - last[2]);
			}
		}
		cardio.now = Date.now();
		if (tracking()) resume();

		cardio.listError = null;
		pb.collection('training_routes')
			.getList(1, 100, {
				filter: pb.filter('user = {:u}', { u: userId }),
				sort: '-started',
				fields: LIST_FIELDS,
				requestKey: null
			})
			.then((res) => {
				if (cancelled) return;
				// Eine waehrend des Ladens gespeicherte Strecke nicht wieder verlieren.
				const known = new Set(res.items.map((r) => r.id));
				cardio.routes = [...cardio.routes.filter((r) => !known.has(r.id)), ...res.items];
				cardio.loading = false;
			})
			.catch((err) => {
				if (cancelled) return;
				cardio.listError = trainingError(err, 'Strecken konnten nicht geladen werden.');
				cardio.loading = false;
			});

		return () => {
			cancelled = true;
		};
	});
}

// Abmelden laedt die Seite nicht neu: ohne das hier liefen GPS und Wake Lock
// weiter. Die Aufzeichnung bleibt gespeichert; syncCardio nimmt sie wieder auf.
pb.authStore.onChange((token, record) => {
	if (record) return;
	persist();
	halt();
});

/** Aus einem Tipp heraus aufrufen: Standort-Abfrage und Wake Lock brauchen ihn. */
export function startRun(kind) {
	if (cardio.run) return;
	points = [];
	cardio.run = { kind, start: Date.now(), stoppedAt: 0, distance: 0, count: 0 };
	cardio.accuracy = null;
	cardio.gap = 0;
	cardio.error = null;
	cardio.version += 1;
	persist();
	resume();
}

/** Aufzeichnung beenden und speichern. Scheitert das Speichern, bleibt sie stehen. */
export async function stopRun() {
	if (!cardio.run) return;
	if (!cardio.run.stoppedAt) {
		cardio.run.stoppedAt = Date.now();
		cardio.now = cardio.run.stoppedAt;
		halt();
		persist();
	}
	await saveRun();
}

/** Eine beendete Aufzeichnung (erneut) speichern. */
export async function saveRun() {
	const run = cardio.run;
	if (!run || !run.stoppedAt || cardio.saving) return;
	const record = pb.authStore.record;
	if (!record) {
		cardio.error = 'Nicht angemeldet – bitte neu anmelden, die Strecke bleibt erhalten.';
		throw new Error(cardio.error);
	}
	// Feste ID: kam beim letzten Versuch nur die Antwort nicht an, scheitert der
	// naechste am Unique-Index statt eine zweite Strecke anzulegen.
	run.id ??= newId();
	persist();
	const startDate = new Date(run.start);
	const pad = (n) => String(n).padStart(2, '0');
	cardio.saving = true;
	cardio.error = null;
	try {
		const created = await pb
			.collection('training_routes')
			.create(
				{
					id: run.id,
					user: record.id,
					date: `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())}`,
					kind: run.kind,
					started: startDate.toISOString(),
					duration: Math.min(86400, Math.round((run.stoppedAt - run.start) / 1000)),
					distance: Math.min(1000000, Math.round(run.distance)),
					points
				},
				{ fields: LIST_FIELDS }
			)
			.catch((err) => {
				if (err?.response?.data?.id?.code !== 'validation_not_unique') throw err;
				// Schon gespeichert -- nur die Antwort war verloren.
				return pb.collection('training_routes').getOne(run.id, { fields: LIST_FIELDS });
			});
		if (!cardio.routes.some((r) => r.id === created.id)) cardio.routes.unshift(created);
		clearRun();
		return created;
	} catch (err) {
		cardio.error = trainingError(err, 'Speichern fehlgeschlagen.');
		throw err;
	} finally {
		cardio.saving = false;
	}
}

function clearRun() {
	halt();
	points = [];
	cardio.run = null;
	cardio.accuracy = null;
	cardio.gap = 0;
	cardio.version += 1;
	persist();
}

/** Aufzeichnung wegwerfen, ohne zu speichern. */
export function discardRun() {
	cardio.error = null;
	clearRun();
}

// --- Gespeicherte Strecken --------------------------------------------------

export function loadRoute(id) {
	return pb.collection('training_routes').getOne(id, { requestKey: null });
}

export async function deleteRoute(id) {
	await pb.collection('training_routes').delete(id);
	const idx = cardio.routes.findIndex((r) => r.id === id);
	if (idx > -1) cardio.routes.splice(idx, 1);
}
