// Skaliert scripts/icon-source.png auf die App-Icons in static/ -- ohne
// Abhaengigkeiten (nur node:zlib). Neu bauen mit:  node scripts/generate-icons.mjs
//
// Die Quelle liegt bewusst *nicht* in static/: sie waere sonst als /icon.png
// ausgeliefert und landete in jedem Build (2,4 MB fuer nichts).
import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'icon-source.png');
const OUT = join(HERE, '..', 'static');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(buf) {
	let c = 0xffffffff;
	for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
}

// --- Lesen -------------------------------------------------------------
// Nur was hier gebraucht wird: 8 Bit pro Kanal, RGB oder RGBA, nicht
// interlaced. Palette (colorType 3) und 16 Bit kommen aus keinem Bildeditor,
// der ein App-Icon exportiert -- lieber laut abbrechen als still falsch.
function decode(file) {
	const b = readFileSync(file);
	if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file}: kein PNG`);

	let head = null;
	const parts = [];
	for (let o = 8; o < b.length; ) {
		const len = b.readUInt32BE(o);
		const type = b.toString('ascii', o + 4, o + 8);
		const data = b.subarray(o + 8, o + 8 + len);
		if (type === 'IHDR')
			head = {
				w: data.readUInt32BE(0),
				h: data.readUInt32BE(4),
				depth: data[8],
				colorType: data[9],
				interlace: data[12]
			};
		else if (type === 'IDAT') parts.push(data);
		else if (type === 'IEND') break;
		o += 12 + len;
	}

	const { w, h, depth, colorType, interlace } = head;
	if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6))
		throw new Error(
			`${file}: erwartet 8-Bit RGB/RGBA ohne Interlacing, ` +
				`ist depth=${depth} colorType=${colorType} interlace=${interlace}`
		);

	const bpp = colorType === 6 ? 4 : 3;
	const stride = w * bpp;
	const raw = inflateSync(Buffer.concat(parts));
	const px = Buffer.alloc(stride * h);

	// Zeilenfilter zuruecknehmen (PNG-Spec 9.2), Vorgaengerzeile ist schon entfiltert
	for (let y = 0; y < h; y++) {
		const filter = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		const row = y * stride;
		const up = (y - 1) * stride;
		for (let i = 0; i < stride; i++) {
			const a = i >= bpp ? px[row + i - bpp] : 0;
			const bb = y > 0 ? px[up + i] : 0;
			const c = y > 0 && i >= bpp ? px[up + i - bpp] : 0;
			let v = line[i];
			if (filter === 1) v += a;
			else if (filter === 2) v += bb;
			else if (filter === 3) v += (a + bb) >> 1;
			else if (filter === 4) {
				const p = a + bb - c;
				const pa = Math.abs(p - a),
					pb = Math.abs(p - bb),
					pc = Math.abs(p - c);
				v += pa <= pb && pa <= pc ? a : pb <= pc ? bb : c;
			}
			px[row + i] = v & 0xff;
		}
	}

	// Auf RGBA normieren, damit der Rest nur einen Fall kennt
	if (bpp === 4) return { w, h, px };
	const rgba = Buffer.alloc(w * h * 4);
	for (let i = 0, o = 0; i < w * h; i++, o += 4) {
		rgba[o] = px[i * 3];
		rgba[o + 1] = px[i * 3 + 1];
		rgba[o + 2] = px[i * 3 + 2];
		rgba[o + 3] = 255;
	}
	return { w, h, px: rgba };
}

// Ein Foto braucht Zeilenfilter: unfiltriert bleibt jedes Pixel ein eigener
// Wert und deflate findet nichts zu wiederholen. Mit Filter stehen dort kleine
// Differenzen zum Nachbarn -- gemessen 645 KB -> 439 KB beim 512er. Dazu ohne
// Alphakanal speichern, wenn keiner gebraucht wird (ein Viertel der Rohdaten).
function encode(size, rgba) {
	let opaque = true;
	for (let i = 3; i < rgba.length; i += 4)
		if (rgba[i] !== 255) {
			opaque = false;
			break;
		}

	const bpp = opaque ? 3 : 4;
	const stride = size * bpp;
	const px = opaque ? Buffer.alloc(stride * size) : rgba;
	if (opaque)
		for (let i = 0, o = 0; i < size * size; i++, o += 3) {
			px[o] = rgba[i * 4];
			px[o + 1] = rgba[i * 4 + 1];
			px[o + 2] = rgba[i * 4 + 2];
		}

	const raw = Buffer.alloc((stride + 1) * size);
	const cand = Buffer.alloc(stride);
	for (let y = 0; y < size; y++) {
		const row = y * stride;
		const up = (y - 1) * stride;
		let best = 0,
			bestCost = Infinity;

		// Heuristik der PNG-Spec (12.8): die Filterart mit der kleinsten Summe
		// der Absolutwerte gewinnt -- kleine Differenzen komprimieren besser.
		for (const filter of [0, 1, 2, 3, 4]) {
			if (filter === 2 && y === 0) continue; // Up auf Zeile 0 ist Filter 0
			let cost = 0;
			for (let i = 0; i < stride; i++) {
				const a = i >= bpp ? px[row + i - bpp] : 0;
				const b = y > 0 ? px[up + i] : 0;
				const c = y > 0 && i >= bpp ? px[up + i - bpp] : 0;
				let v = px[row + i];
				if (filter === 1) v -= a;
				else if (filter === 2) v -= b;
				else if (filter === 3) v -= (a + b) >> 1;
				else if (filter === 4) {
					const p = a + b - c;
					const pa = Math.abs(p - a),
						pb = Math.abs(p - b),
						pc = Math.abs(p - c);
					v -= pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
				}
				v &= 0xff;
				cand[i] = v;
				cost += v < 128 ? v : 256 - v; // als vorzeichenbehaftetes Byte
			}
			if (cost < bestCost) {
				bestCost = cost;
				best = filter;
				cand.copy(raw, y * (stride + 1) + 1);
			}
		}
		raw[y * (stride + 1)] = best;
	}

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = opaque ? 2 : 6; // RGB bzw. RGBA
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

// --- Skalieren ---------------------------------------------------------
// Flaechenmittel (Box-Filter): jedes Zielpixel ist der Durchschnitt aller
// Quellpixel, die es ueberdeckt. Bei 1254 -> 192 sind das ~43 Pixel; ein
// naives Sampling wuerde 42 davon wegwerfen und in den feinen Baeumen und
// Wasserspiegelungen sichtbar flimmern.
function resize(src, size) {
	if (src.w !== src.h) throw new Error(`Quelle ist ${src.w}x${src.h}, erwartet quadratisch`);
	const out = Buffer.alloc(size * size * 4);
	const scale = src.w / size;

	for (let y = 0; y < size; y++) {
		const y0 = y * scale,
			y1 = (y + 1) * scale;
		const sy0 = Math.floor(y0),
			sy1 = Math.min(Math.ceil(y1), src.h);
		for (let x = 0; x < size; x++) {
			const x0 = x * scale,
				x1 = (x + 1) * scale;
			const sx0 = Math.floor(x0),
				sx1 = Math.min(Math.ceil(x1), src.w);

			let r = 0,
				g = 0,
				b = 0,
				a = 0,
				wsum = 0;
			for (let sy = sy0; sy < sy1; sy++) {
				// Randpixel zaehlen nur zum Teil, sonst ruckelt das Raster
				const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
				for (let sx = sx0; sx < sx1; sx++) {
					const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
					const wgt = wy * wx;
					const o = (sy * src.w + sx) * 4;
					r += src.px[o] * wgt;
					g += src.px[o + 1] * wgt;
					b += src.px[o + 2] * wgt;
					a += src.px[o + 3] * wgt;
					wsum += wgt;
				}
			}
			const o = (y * size + x) * 4;
			out[o] = Math.round(r / wsum);
			out[o + 1] = Math.round(g / wsum);
			out[o + 2] = Math.round(b / wsum);
			out[o + 3] = Math.round(a / wsum);
		}
	}
	return out;
}

const src = decode(SRC);
console.log(`Quelle: ${src.w}x${src.h}`);

// 32 als Favicon (der 192er waere 72 KB auf jedem Seitenaufruf),
// 192 fuer den Install-Prompt und als apple-touch-icon (iOS: 180, skaliert),
// 512 fuer Splashscreen und Android-Adaptive-Icon.
// Kein eigenes maskable-PNG: das Bild ist randlos, ein Beschnitt auf die
// Safe-Zone trifft nur Himmel und Baumkronen -- deshalb steht am 512er im
// Manifest "any maskable". Ein aufgepolsterter Rand waere hier das
// haesslichere Ergebnis.
for (const size of [32, 192, 512]) {
	const data = encode(size, resize(src, size));
	const name = `icon-${size}.png`;
	writeFileSync(join(OUT, name), data);
	console.log(name, data.length, 'bytes');
}
