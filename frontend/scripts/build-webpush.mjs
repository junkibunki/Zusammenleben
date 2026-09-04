// Buendelt scripts/webpush.entry.js samt @noble-Krypto zu einer CommonJS-Datei
// fuer PocketBases JS-VM: pb/pb_hooks/webpush.js.
//
// Warum ein Bundle: die JS-VM loest `require('paket')` nicht aus node_modules
// auf ("GoError: Invalid module"), nur relative Pfade. Und der Server bekommt
// beim Deploy kein npm zu sehen -- deshalb liegt das Ergebnis im Repo.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outfile = resolve(here, '../../pb/pb_hooks/webpush.js');

// Die JS-VM hat keine WebCrypto. @noble holt sich Zufall ueber
// crypto.getRandomValues, also wird das hier nachgeruestet -- vor allen
// Modulkoerpern, damit es beim Import schon steht. In Node greift der Zweig
// nicht, dort gibt es globalThis.crypto: dasselbe Bundle laeuft im Test.
const banner = `// GENERIERT von frontend/scripts/build-webpush.mjs -- nicht von Hand aendern.
if (typeof globalThis.crypto === 'undefined') {
	globalThis.crypto = {
		getRandomValues(out) {
			// $security.randomString kommt aus crypto/rand, liefert aber nur
			// alphanumerische Zeichen; SHA-256 macht daraus gleichverteilte Bytes.
			for (let off = 0; off < out.length; off += 32) {
				const hex = $security.sha256($security.randomString(64));
				for (let i = 0; i < 32 && off + i < out.length; i++) {
					out[off + i] = parseInt(hex.substr(i * 2, 2), 16);
				}
			}
			return out;
		}
	};
}
`;

await build({
	entryPoints: [resolve(here, 'webpush.entry.js')],
	outfile,
	bundle: true,
	format: 'cjs',
	platform: 'neutral',
	// goja kann kein ES2020+ zuverlaessig; BigInt-Literale lassen sich aber
	// nicht herunterschreiben, deshalb nicht tiefer als es2020.
	target: 'es2020',
	banner: { js: banner },
	legalComments: 'none'
});

console.log('Fertig: ' + outfile);
