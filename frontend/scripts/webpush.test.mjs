// Selbsttest der Krypto in pb/pb_hooks/webpush.js: `npm run test:hooks`.
//
// Die Signatur prueft bewusst Node WebCrypto und nicht dieselbe Bibliothek,
// die sie erzeugt hat. Genau daran hing hier ein Fehler: @noble/curves v2
// hasht in `sign` selbst, bekam aber den Hash uebergeben -- und `p256.verify`
// hashte ebenso doppelt und bestaetigte die kaputte Signatur. Aufgefallen ist
// es erst an einem fremden Pruefer.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { webcrypto } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const wp = require(resolve(here, '../../pb/pb_hooks/webpush.js'));

let fehler = 0;
const pruefe = (label, ok, extra = '') => {
	console.log((ok ? '  ok   ' : '  FEHL ') + label + (extra ? ' -- ' + extra : ''));
	if (!ok) fehler++;
};

// Testvektor aus RFC 8291, Abschnitt 5.
const body = wp.encryptPayload(
	'When I grow up, I want to be a watermelon',
	'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
	'BTBZMqHH6r4Tts7J_aSIgg',
	{
		salt: wp.fromBase64url('DGv6ra1nlYgDCS1FRnbzlw'),
		asSecretKey: wp.fromBase64url('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw')
	}
);
const erwartet =
	'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLoc' +
	'InmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLV' +
	'WGNWQexSgSxsj_Qulcy4a-fN';
pruefe('RFC 8291 aes128gcm', wp.toBase64url(body) === erwartet);

// base64url mit allen 256 Bytewerten
const alle = new Uint8Array(256).map((_, i) => i);
pruefe(
	'base64url hin und zurueck',
	wp.toBase64url(wp.fromBase64url(wp.toBase64url(alle))) === wp.toBase64url(alle)
);

const keys = wp.generateVapidKeys();
pruefe(
	'Schluessellaengen 65/32',
	wp.fromBase64url(keys.publicKey).length === 65 && wp.fromBase64url(keys.privateKey).length === 32
);

const header = wp.vapidHeader(
	'https://fcm.googleapis.com/fcm/send/abc?x=1',
	keys.publicKey,
	keys.privateKey,
	'https://gruenerfreund.de'
);
const [h, c, s] = header.match(/t=([^,]+)/)[1].split('.');
const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
pruefe('aud ist der Origin des Endpoints', claims.aud === 'https://fcm.googleapis.com', claims.aud);
pruefe(
	'exp liegt innerhalb von 24 h',
	claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 86400
);
pruefe('k= ist der unkomprimierte Punkt', wp.fromBase64url(header.match(/k=(.+)$/)[1]).length === 65);

const pub = Buffer.from(keys.publicKey, 'base64url');
const publicKey = await webcrypto.subtle.importKey(
	'jwk',
	{
		kty: 'EC',
		crv: 'P-256',
		x: pub.subarray(1, 33).toString('base64url'),
		y: pub.subarray(33, 65).toString('base64url'),
		ext: true
	},
	{ name: 'ECDSA', namedCurve: 'P-256' },
	false,
	['verify']
);
pruefe(
	'ES256-Signatur laut Node WebCrypto',
	await webcrypto.subtle.verify(
		{ name: 'ECDSA', hash: 'SHA-256' },
		publicKey,
		Buffer.from(s, 'base64url'),
		new TextEncoder().encode(h + '.' + c)
	)
);

pruefe(
	'Nutzlast mit Umlaut und Emoji',
	wp.encryptPayload(
		JSON.stringify({ title: 'Neu: Möhren 🥕', body: 'Obst/Gemüse · von Anna' }),
		'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
		'BTBZMqHH6r4Tts7J_aSIgg'
	).length > 100
);

let geworfen = false;
try {
	wp.vapidHeader('kein-endpoint', keys.publicKey, keys.privateKey, 'https://x.de');
} catch {
	geworfen = true;
}
pruefe('Endpoint ohne Origin wirft', geworfen);

console.log(fehler === 0 ? '\nAlles gruen.' : `\n${fehler} Fehler.`);
process.exit(fehler === 0 ? 0 : 1);
