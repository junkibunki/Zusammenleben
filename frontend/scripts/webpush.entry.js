// Quelle des Bundles pb/pb_hooks/webpush.js -- siehe scripts/build-webpush.mjs.
// Web Push nach RFC 8291 (aes128gcm) + RFC 8292 (VAPID/ES256), gebaut fuer
// PocketBases JS-VM: dort gibt es keine WebCrypto, deshalb reine JS-Krypto.
import { p256 } from '@noble/curves/nist.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { gcm } from '@noble/ciphers/aes.js';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Bytes -> base64url ohne Padding. Von Hand, weil die JS-VM kein btoa hat. */
export function toBase64url(bytes) {
	let out = '';
	for (let i = 0; i < bytes.length; i += 3) {
		const a = bytes[i];
		const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
		const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
		out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
		if (i + 1 < bytes.length) out += B64[((b & 15) << 2) | (c >> 6)];
		if (i + 2 < bytes.length) out += B64[c & 63];
	}
	return out;
}

/** base64url *oder* base64 (mit/ohne Padding) -> Bytes. */
export function fromBase64url(text) {
	const clean = String(text).replace(/[^A-Za-z0-9+/\-_]/g, '');
	const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
	let bits = 0;
	let acc = 0;
	let n = 0;
	for (const ch of clean) {
		const idx = ch === '+' ? 62 : ch === '/' ? 63 : B64.indexOf(ch);
		if (idx < 0) continue;
		acc = (acc << 6) | idx;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[n++] = (acc >> bits) & 0xff;
		}
	}
	return out.subarray(0, n);
}

/** UTF-8-Bytes eines Strings. Die JS-VM hat kein TextEncoder. */
function utf8(text) {
	const out = [];
	for (let i = 0; i < text.length; i++) {
		let code = text.charCodeAt(i);
		// Surrogatpaar zu einem Codepoint zusammenziehen (Emoji, z.B. "🎉").
		if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
			const low = text.charCodeAt(i + 1);
			if (low >= 0xdc00 && low <= 0xdfff) {
				code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
				i++;
			}
		}
		if (code < 0x80) out.push(code);
		else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
		else if (code < 0x10000)
			out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
		else
			out.push(
				0xf0 | (code >> 18),
				0x80 | ((code >> 12) & 0x3f),
				0x80 | ((code >> 6) & 0x3f),
				0x80 | (code & 0x3f)
			);
	}
	return new Uint8Array(out);
}

function concat(...parts) {
	let len = 0;
	for (const p of parts) len += p.length;
	const out = new Uint8Array(len);
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

/** Ein neues VAPID-Schluesselpaar, beide Teile base64url. */
export function generateVapidKeys() {
	const secretKey = p256.utils.randomSecretKey();
	return {
		publicKey: toBase64url(p256.getPublicKey(secretKey, false)),
		privateKey: toBase64url(secretKey)
	};
}

/**
 * Verschluesselt die Payload fuer genau ein Abo (Content-Encoding aes128gcm).
 * `salt` und `asSecretKey` sind nur fuer Testvektoren gedacht; normal wuerfelt
 * die Funktion beides selbst.
 */
export function encryptPayload(payload, uaPublicKey, authSecret, options = {}) {
	const plaintext = payload instanceof Uint8Array ? payload : utf8(String(payload));
	const uaPublic = uaPublicKey instanceof Uint8Array ? uaPublicKey : fromBase64url(uaPublicKey);
	const auth = authSecret instanceof Uint8Array ? authSecret : fromBase64url(authSecret);

	const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
	const asSecret = options.asSecretKey ?? p256.utils.randomSecretKey();
	const asPublic = p256.getPublicKey(asSecret, false);

	// getSharedSecret liefert einen komprimierten Punkt; RFC 8291 will nur X.
	const shared = p256.getSharedSecret(asSecret, uaPublic).subarray(1);

	// RFC 8291 3.4: erst das Abo-Geheimnis einmischen, dann Salt und Info.
	const keyInfo = concat(utf8('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic);
	const ikm = hkdf(sha256, shared, auth, keyInfo, 32);
	const cek = hkdf(sha256, ikm, salt, utf8('Content-Encoding: aes128gcm\0'), 16);
	const nonce = hkdf(sha256, ikm, salt, utf8('Content-Encoding: nonce\0'), 12);

	// 0x02 ist der Delimiter des letzten Records -- ohne ihn verwirft der
	// Browser die Nachricht still.
	const padded = concat(plaintext, new Uint8Array([2]));
	const ciphertext = gcm(cek, nonce).encrypt(padded);

	const recordSize = options.recordSize ?? 4096;
	const header = new Uint8Array(5);
	header[0] = (recordSize >>> 24) & 0xff;
	header[1] = (recordSize >>> 16) & 0xff;
	header[2] = (recordSize >>> 8) & 0xff;
	header[3] = recordSize & 0xff;
	header[4] = asPublic.length;

	return concat(salt, header, asPublic, ciphertext);
}

/** Signiertes VAPID-JWT fuer den Authorization-Header eines Endpoints. */
export function vapidHeader(endpoint, publicKey, privateKey, subject, ttlSeconds = 12 * 60 * 60) {
	const origin = String(endpoint).match(/^(https?:\/\/[^/]+)/)?.[1];
	if (!origin) throw new Error('Endpoint ohne Origin: ' + endpoint);

	const header = toBase64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
	const claims = toBase64url(
		utf8(
			JSON.stringify({
				aud: origin,
				exp: Math.floor(Date.now() / 1000) + ttlSeconds,
				sub: subject
			})
		)
	);

	const signingInput = header + '.' + claims;
	// Die *Nachricht* uebergeben, nicht ihren Hash: p256.sign hasht selbst
	// (`prehash` ist in @noble/curves v2 standardmaessig an). Mit dem Hash als
	// Eingabe wird zweimal gehasht -- und p256.verify macht denselben Fehler
	// noch einmal und bestaetigt die kaputte Signatur. Aufgefallen ist es erst
	// an einem fremden Pruefer (Node WebCrypto) und an FCMs
	// "permission denied: invalid JWT provided".
	const signature = p256.sign(utf8(signingInput), fromBase64url(privateKey), {
		format: 'compact'
	});

	return 'vapid t=' + signingInput + '.' + toBase64url(signature) + ', k=' + publicKey;
}

/**
 * Alles, was $http.send fuer eine Push-Nachricht braucht.
 * `body` ist bewusst ein Uint8Array: als String wuerde die JS-VM die Bytes
 * als UTF-8 kodieren und der Push-Dienst bekaeme Datenmuell.
 */
export function buildRequest({
	endpoint,
	p256dh,
	auth,
	payload,
	publicKey,
	privateKey,
	subject,
	ttl = 3600,
	urgency = 'normal'
}) {
	return {
		url: endpoint,
		method: 'POST',
		body: encryptPayload(payload, p256dh, auth),
		headers: {
			Authorization: vapidHeader(endpoint, publicKey, privateKey, subject),
			'Content-Encoding': 'aes128gcm',
			'Content-Type': 'application/octet-stream',
			TTL: String(ttl),
			Urgency: urgency
		}
	};
}
