import { describe, expect, it } from 'vitest';
import { getPasskeyDevice } from './passkey-device';

describe('passkey device suggestions', () => {
	it.each([
		['mac', 'MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0],
		['iphone', 'iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5],
		['ipad', 'iPad', 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', 5],
		['ipad', 'MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5],
		['ipod', 'iPod', 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)', 5],
		['android', 'Linux armv8l', 'Mozilla/5.0 (Linux; Android 10; K)', 5],
		['windows', 'Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0],
		['chromebook', 'Linux x86_64', 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)', 0],
		['linux', 'Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)', 0],
		['mac', '', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0],
		['windows', '', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0],
		['other', '', '', 0]
	])('suggests %s for %s, %s, %i touch points', (expected, platform, userAgent, maxTouchPoints) => {
		expect(getPasskeyDevice({ platform, userAgent, maxTouchPoints })).toBe(expected);
	});

	it('has a generic server-rendering fallback', () => {
		expect(getPasskeyDevice()).toBe('other');
	});
});
