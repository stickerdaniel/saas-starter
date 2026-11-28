import { describe, expect, it } from 'vitest';
import { LOCAL_CONVEX_BINARY_VERSION } from './local-convex-binary';

describe('local Convex binary', () => {
	it('pins one precompiled backend release', () => {
		expect(LOCAL_CONVEX_BINARY_VERSION).toMatch(/^precompiled-\d{4}-\d{2}-\d{2}-[0-9a-f]{7,}$/);
	});
});
