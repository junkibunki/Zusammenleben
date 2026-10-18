<script>
	// Kleines Liniendiagramm ohne Abhaengigkeiten: eine Reihe, x = Datum (echter
	// Zeitabstand), y = Wert. Farben nur aus den Tokens in app.css, damit hell und
	// dunkel von allein stimmen. Die Zahlen stehen fuer Screenreader zusaetzlich
	// als Liste darunter; der Tooltip ist nur Komfort.

	/**
	 * @type {{
	 *   points?: { date: string, value: number }[],
	 *   unit?: string,
	 *   label?: string,
	 *   format?: (value: number) => string
	 * }}
	 */
	let { points = [], unit = '', label = 'Verlauf', format = undefined } = $props();

	const HEIGHT = 168;
	// Oben Platz fuer die Beschriftung des letzten Werts, unten fuer die Daten.
	const TOP = 26;
	const BOTTOM = 22;
	const RIGHT = 10;

	let width = $state(0);
	let active = $state(-1);

	function fmt(value) {
		if (format) return format(value);
		const n = Number(value).toLocaleString('de-DE', { maximumFractionDigits: 1 });
		return unit ? `${n} ${unit}` : n;
	}

	/** "2026-10-02" -> Tage seit 1970 (UTC, ohne Sommerzeit-Spruenge). */
	function dayNumber(date) {
		const [y, m, d] = String(date).split('-').map(Number);
		return Date.UTC(y, m - 1, d) / 86400000;
	}

	/** "2026-10-02" -> "02.10.26" */
	function shortDate(date) {
		const [y, m, d] = String(date).split('-');
		return `${d}.${m}.${String(y).slice(2)}`;
	}

	const data = $derived(
		points.filter((p) => p && p.date && Number.isFinite(Number(p.value)))
	);

	const range = $derived.by(() => {
		if (data.length === 0) return null;
		const values = data.map((p) => Number(p.value));
		const min = Math.min(...values);
		const max = Math.max(...values);
		// Etwas Luft ueber und unter den Extremwerten; bei nur einem Wert (oder
		// lauter gleichen) ein kuenstliches Band, sonst teilte man durch 0.
		const pad = max > min ? (max - min) * 0.08 : Math.max(1, Math.abs(max) * 0.05);
		return {
			min,
			max,
			lo: min - pad,
			hi: max + pad,
			d0: dayNumber(data[0].date),
			d1: dayNumber(data[data.length - 1].date)
		};
	});

	// Breite der linken Spalte nach der laengsten Achsenbeschriftung (11px-Schrift).
	const gutter = $derived(
		range ? Math.ceil(Math.max(fmt(range.min).length, fmt(range.max).length) * 6.4) + 10 : 0
	);

	const coords = $derived.by(() => {
		if (!range || width <= 0) return [];
		const x0 = gutter;
		const x1 = Math.max(x0 + 1, width - RIGHT);
		const y0 = TOP;
		const y1 = HEIGHT - BOTTOM;
		const span = range.d1 - range.d0;
		return data.map((p) => ({
			date: p.date,
			value: Number(p.value),
			x: span > 0 ? x0 + ((dayNumber(p.date) - range.d0) / span) * (x1 - x0) : (x0 + x1) / 2,
			y: y1 - ((Number(p.value) - range.lo) / (range.hi - range.lo)) * (y1 - y0)
		}));
	});

	const yOf = (v) =>
		HEIGHT - BOTTOM - ((v - range.lo) / (range.hi - range.lo)) * (HEIGHT - BOTTOM - TOP);

	const line = $derived(
		coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
	);
	const area = $derived(
		coords.length > 1
			? `${line} L${coords[coords.length - 1].x.toFixed(1)},${HEIGHT - BOTTOM} L${coords[0].x.toFixed(1)},${HEIGHT - BOTTOM} Z`
			: ''
	);

	// Punkte nur, solange sie sich nicht ueberlappen; der letzte steht immer da.
	const showDots = $derived(
		coords.length > 0 && (width - gutter - RIGHT) / Math.max(1, coords.length - 1) >= 14
	);

	const last = $derived(coords[coords.length - 1]);
	const current = $derived(active >= 0 ? coords[active] : undefined);

	const summary = $derived.by(() => {
		if (!range) return `${label}: noch keine Werte`;
		const end = data[data.length - 1];
		if (data.length === 1) return `${label}: ein Wert, ${fmt(end.value)} am ${shortDate(end.date)}`;
		return `${label}: ${data.length} Werte vom ${shortDate(data[0].date)} bis ${shortDate(end.date)}, zwischen ${fmt(range.min)} und ${fmt(range.max)}, zuletzt ${fmt(end.value)}`;
	});

	// Maus: Tooltip folgt dem Zeiger und verschwindet beim Verlassen. Touch: der
	// Finger hebt sich (pointerleave) -- der Wert bleibt bis zum naechsten Tipp stehen.
	function pick(e) {
		if (coords.length === 0) return;
		const box = e.currentTarget.getBoundingClientRect();
		const px = e.clientX - box.left;
		let best = 0;
		for (let i = 1; i < coords.length; i++) {
			if (Math.abs(coords[i].x - px) < Math.abs(coords[best].x - px)) best = i;
		}
		active = best;
	}
</script>

{#if data.length === 0}
	<p class="text-muted-foreground py-6 text-center text-sm">Noch keine Werte.</p>
{:else}
	<div
		class="relative w-full touch-pan-y select-none"
		style="height: {HEIGHT}px"
		bind:clientWidth={width}
	>
		{#if width > 0 && range}
			<svg
				role="img"
				aria-label={summary}
				width={width}
				height={HEIGHT}
				viewBox="0 0 {width} {HEIGHT}"
				class="block overflow-visible"
				onpointermove={pick}
				onpointerdown={pick}
				onpointerleave={(e) => e.pointerType === 'mouse' && (active = -1)}
			>
				<!-- Haarlinien bei Minimum und Maximum, beschriftet links -->
				{#each range.max > range.min ? [range.max, range.min] : [range.max] as v (v)}
					<line
						x1={gutter}
						x2={width - RIGHT}
						y1={yOf(v)}
						y2={yOf(v)}
						class="stroke-border"
						stroke-width="1"
					/>
					<text
						x={gutter - 6}
						y={yOf(v)}
						text-anchor="end"
						dominant-baseline="middle"
						class="fill-muted-foreground text-[11px] tabular-nums">{fmt(v)}</text
					>
				{/each}

				<!-- Erstes und letztes Datum -->
				<text
					x={coords.length > 1 ? coords[0].x : (gutter + width - RIGHT) / 2}
					y={HEIGHT - 6}
					text-anchor={coords.length > 1 ? 'start' : 'middle'}
					class="fill-muted-foreground text-[11px] tabular-nums">{shortDate(data[0].date)}</text
				>
				{#if coords.length > 1}
					<text
						x={last.x}
						y={HEIGHT - 6}
						text-anchor="end"
						class="fill-muted-foreground text-[11px] tabular-nums"
						>{shortDate(data[data.length - 1].date)}</text
					>
				{/if}

				{#if area}
					<path d={area} class="fill-primary" fill-opacity="0.1" />
				{/if}
				{#if coords.length > 1}
					<path
						d={line}
						fill="none"
						class="stroke-primary"
						stroke-width="2"
						stroke-linejoin="round"
						stroke-linecap="round"
					/>
				{/if}

				{#if current}
					<line
						x1={current.x}
						x2={current.x}
						y1={TOP - 4}
						y2={HEIGHT - BOTTOM}
						class="stroke-muted-foreground"
						stroke-width="1"
					/>
				{/if}

				{#if showDots}
					{#each coords.slice(0, -1) as c, i (i)}
						<circle cx={c.x} cy={c.y} r="4" class="fill-primary stroke-card" stroke-width="2" />
					{/each}
				{/if}
				{#if current && current !== last}
					<circle
						cx={current.x}
						cy={current.y}
						r="5"
						class="fill-primary stroke-card"
						stroke-width="2"
					/>
				{/if}

				<!-- Der juengste Wert: groesser und direkt beschriftet -->
				<circle cx={last.x} cy={last.y} r="5.5" class="fill-primary stroke-card" stroke-width="2" />
				<text
					x={last.x}
					y={last.y - 11}
					text-anchor={coords.length > 1 ? 'end' : 'middle'}
					class="fill-foreground text-xs font-semibold tabular-nums">{fmt(last.value)}</text
				>
			</svg>

			{#if current}
				<div
					aria-hidden="true"
					class="bg-popover text-popover-foreground pointer-events-none absolute top-0 -translate-x-1/2 rounded-md border px-2 py-1 text-xs whitespace-nowrap shadow-sm"
					style="left: {Math.min(Math.max(current.x, 56), width - 56)}px"
				>
					<span class="font-semibold tabular-nums">{fmt(current.value)}</span>
					<span class="text-muted-foreground ml-1">{shortDate(current.date)}</span>
				</div>
			{/if}
		{/if}
	</div>

	<ul class="sr-only" aria-label="Werte: {label}">
		{#each data as p, i (i)}
			<li>{shortDate(p.date)}: {fmt(p.value)}</li>
		{/each}
	</ul>
{/if}
