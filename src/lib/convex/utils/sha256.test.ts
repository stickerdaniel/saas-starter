import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';

describe('sha256Hex', () => {
	it('matches the FIPS 180-4 known vectors', () => {
		expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
		expect(sha256Hex('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
		// 56-byte input: forces a second padding block.
		expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
			'248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
		);
	});

	it('handles block-boundary lengths', () => {
		// 56 bytes forces the length into an extra block; 64 bytes is an exact block.
		expect(sha256Hex('y'.repeat(56))).toBe(
			'4877e564e5e36e367c7c8d59670774becd3350610b6df4c399c9fa9b66da5813'
		);
		expect(sha256Hex('z'.repeat(64))).toBe(
			'72996563049cc84daa2c3f31fd5c3d10770e69d6ebbb8da5b6d76db303dbae43'
		);
	});

	it('encodes multi-byte UTF-8 (2/3/4-byte + surrogate pairs) correctly', () => {
		// Covers 2-byte (ü, é), 3-byte (☕, 日本語) and 4-byte (😀) code points.
		expect(sha256Hex('grüße café ☕ 日本語 😀')).toBe(
			'0fe73bc5e6442dc08288ad538a8c714f1aed915e76d0e6f7918bf21d283a1fd9'
		);
	});

	it('is deterministic and distinct across inputs', () => {
		expect(sha256Hex('ACoAAB1exampleProviderId')).toBe(
			'17d0de73bd35bd84a83aa40f04add8d410a12cd0ff85a2619d3a158eb30a3d3b'
		);
		expect(sha256Hex('a')).not.toBe(sha256Hex('b'));
	});

	it('returns 64 lowercase hex chars', () => {
		expect(sha256Hex('anything')).toMatch(/^[0-9a-f]{64}$/);
	});
});
