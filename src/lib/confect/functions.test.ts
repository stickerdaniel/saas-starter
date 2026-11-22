import { describe, expect, it, vi } from 'vitest';
import { CUSTOM_REGISTRARS } from '../../../eslint/convex-registrars.js';

vi.mock('./authServer', () => ({ authComponent: {} }));

describe('custom Convex builders', () => {
	// The ESLint rules read custom registrations by these names, so a builder
	// missing from the list registers functions no rule checks.
	it('are exactly the builders the lint rules recognise', async () => {
		const builders = await import('./functions');
		expect(Object.keys(builders).sort()).toEqual([...CUSTOM_REGISTRARS].sort());
	});
});
