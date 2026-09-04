// Erzeugt die drei Platzhalter-Icons als echte PNGs -- ohne Abhaengigkeiten
// (nur node:zlib). Neu bauen mit:  node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'static');

const BG = [0x17, 0x17, 0x17]; // --primary (#171717)
const FG = [0xff, 0xff, 0xff];

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

function png(size, pixel) {
	const stride = size * 4;
	const raw = Buffer.alloc((stride + 1) * size);
	for (let y = 0; y < size; y++) {
		const row = y * (stride + 1);
		raw[row] = 0; // Filter: none
		for (let x = 0; x < size; x++) {
			const [r, g, b, a] = pixel(x, y);
			const o = row + 1 + x * 4;
			raw[o] = r;
			raw[o + 1] = g;
			raw[o + 2] = b;
			raw[o + 3] = a;
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // RGBA
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

// Einkaufstasche: abgerundeter Korpus + Henkelbogen, in relativen Koordinaten.
function bag(u, v, scale) {
	const x = (u - 0.5) / scale + 0.5;
	const y = (v - 0.5) / scale + 0.5;

	const bx0 = 0.27,
		bx1 = 0.73,
		by0 = 0.44,
		by1 = 0.8,
		r = 0.06;
	const cx = Math.min(Math.max(x, bx0 + r), bx1 - r);
	const cy = Math.min(Math.max(y, by0 + r), by1 - r);
	const inBody = Math.hypot(x - cx, y - cy) <= r + 1e-6;

	const d = Math.hypot(x - 0.5, y - 0.45);
	const inHandle = y < 0.45 && d > 0.12 && d < 0.155;

	// Falzkante der Tuete -- unterscheidet die Silhouette vom Vorhaengeschloss
	const fold = inBody && y > 0.515 && y < 0.535;

	return (inBody || inHandle) && !fold;
}

function make(size, scale, name) {
	const ss = 2; // 2x2 Supersampling gegen harte Kanten
	const data = png(size, (px, py) => {
		let hits = 0;
		for (let sy = 0; sy < ss; sy++) {
			for (let sx = 0; sx < ss; sx++) {
				const u = (px + (sx + 0.5) / ss) / size;
				const v = (py + (sy + 0.5) / ss) / size;
				if (bag(u, v, scale)) hits++;
			}
		}
		const t = hits / (ss * ss);
		return [
			Math.round(BG[0] + (FG[0] - BG[0]) * t),
			Math.round(BG[1] + (FG[1] - BG[1]) * t),
			Math.round(BG[2] + (FG[2] - BG[2]) * t),
			255
		];
	});
	writeFileSync(join(OUT, name), data);
	console.log(name, data.length, 'bytes');
}

make(192, 1, 'icon-192.png');
make(512, 1, 'icon-512.png');
// maskable: kleineres Motiv, damit nichts im Safe-Zone-Zuschnitt abgeschnitten wird
make(512, 0.72, 'icon-512-maskable.png');
