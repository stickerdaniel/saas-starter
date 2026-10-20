/** Pure UTF-8 SHA-256 for deterministic Convex queries and mutations. */

// SHA-256 round constants (first 32 bits of the fractional parts of the cube
// roots of the first 64 primes).
const K = new Uint32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function rotr(x: number, n: number): number {
	return (x >>> n) | (x << (32 - n));
}

/** UTF-8 encode a string to a byte array (no TextEncoder dependency). */
function utf8Bytes(str: string): number[] {
	const bytes: number[] = [];
	for (let i = 0; i < str.length; i++) {
		let code = str.charCodeAt(i);
		if (code < 0x80) {
			bytes.push(code);
		} else if (code < 0x800) {
			bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
		} else if (code >= 0xd800 && code <= 0xdbff) {
			// High surrogate: combine with the following low surrogate.
			const lo = str.charCodeAt(++i);
			code = 0x10000 + ((code - 0xd800) << 10) + (lo - 0xdc00);
			bytes.push(
				0xf0 | (code >> 18),
				0x80 | ((code >> 12) & 0x3f),
				0x80 | ((code >> 6) & 0x3f),
				0x80 | (code & 0x3f)
			);
		} else {
			bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
		}
	}
	return bytes;
}

/**
 * SHA-256 hex digest (64 lowercase hex chars) of a UTF-8 encoded string.
 *
 * The eight hash words are scalars (h0..h7), block words are read via
 * `DataView.getUint32` (typed `number`), and the `!` on `w[..]`/`K[i]` reads is
 * safe: every index is provably in-bounds (loop bounds are constant), and the
 * project's `noUncheckedIndexedAccess` would otherwise widen typed-array reads
 * to `number | undefined`.
 */
export function sha256Hex(input: string): string {
	const src = utf8Bytes(input);
	const bitLen = src.length * 8;

	// Pad: 0x80, then zeros up to 56 mod 64, then the 64-bit big-endian bit
	// length, so the total is a whole number of 512-bit blocks.
	const zeros = (56 - ((src.length + 1) % 64) + 64) % 64;
	const total = src.length + 1 + zeros + 8;
	const msg = new Uint8Array(total);
	msg.set(src);
	msg[src.length] = 0x80;
	const dv = new DataView(msg.buffer);
	dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000), false);
	dv.setUint32(total - 4, bitLen >>> 0, false);

	let h0 = 0x6a09e667;
	let h1 = 0xbb67ae85;
	let h2 = 0x3c6ef372;
	let h3 = 0xa54ff53a;
	let h4 = 0x510e527f;
	let h5 = 0x9b05688c;
	let h6 = 0x1f83d9ab;
	let h7 = 0x5be0cd19;
	const w = new Uint32Array(64);

	for (let off = 0; off < total; off += 64) {
		for (let i = 0; i < 16; i++) {
			w[i] = dv.getUint32(off + i * 4, false);
		}
		for (let i = 16; i < 64; i++) {
			const x15 = w[i - 15]!;
			const x2 = w[i - 2]!;
			const s0 = rotr(x15, 7) ^ rotr(x15, 18) ^ (x15 >>> 3);
			const s1 = rotr(x2, 17) ^ rotr(x2, 19) ^ (x2 >>> 10);
			w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
		}

		let a = h0;
		let b = h1;
		let c = h2;
		let d = h3;
		let e = h4;
		let f = h5;
		let g = h6;
		let hh = h7;

		for (let i = 0; i < 64; i++) {
			const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
			const ch = (e & f) ^ (~e & g);
			const t1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0;
			const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
			const maj = (a & b) ^ (a & c) ^ (b & c);
			const t2 = (S0 + maj) >>> 0;
			hh = g;
			g = f;
			f = e;
			e = (d + t1) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (t1 + t2) >>> 0;
		}

		h0 = (h0 + a) >>> 0;
		h1 = (h1 + b) >>> 0;
		h2 = (h2 + c) >>> 0;
		h3 = (h3 + d) >>> 0;
		h4 = (h4 + e) >>> 0;
		h5 = (h5 + f) >>> 0;
		h6 = (h6 + g) >>> 0;
		h7 = (h7 + hh) >>> 0;
	}

	return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, '0')).join('');
}
