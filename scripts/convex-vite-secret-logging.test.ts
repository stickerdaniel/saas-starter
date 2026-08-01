// convex-vite-plugin prints every value it hands the local Convex backend, plus
// the backend's generated instance secret and admin key, straight to the dev
// console (upstream: juliusmarminge/agent-tools#24). We redact all three at the
// source with patches/convex-vite-plugin@0.4.0.patch.
//
// This asserts the *installed* artifacts rather than the patch file, because
// three things can go wrong silently: the patch is not registered, it fails to
// apply on install, or a dependency upgrade moves the code out from under it.
// The plugin's `exports["."]` resolves to dist/index.mjs and it has no `main`,
// so a patch that only touched src/ would change nothing at runtime — reading
// what the resolver actually reaches is what makes that case fail here.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const entry = require.resolve('convex-vite-plugin');

/** The backend chunk's filename is content-hashed, so find it rather than pin it. */
function backendChunk(): string {
	const dir = path.dirname(entry);
	const match = fs
		.readdirSync(dir)
		.find((file) => file.startsWith('backend-') && file.endsWith('.mjs'));
	expect(match, `no backend-*.mjs chunk beside ${entry}`).toBeDefined();
	return path.join(dir, match!);
}

describe('convex-vite-plugin secret logging', () => {
	it('resolves to the bundled entry the plugin actually runs', () => {
		expect(entry).toMatch(/[\\/]dist[\\/]index\.mjs$/);
	});

	it('logs env var names without their values', () => {
		const source = fs.readFileSync(entry, 'utf-8');
		expect(source).toContain('Set environment variable: ${name} = [REDACTED]');
		expect(source).not.toContain('Set environment variable: ${name} = ${value}');
	});

	// Scoped to the banner strings on purpose: the admin key legitimately appears
	// in this chunk as an Authorization header, so banning the interpolation
	// outright would fail against correct code.
	it('logs the backend banner without the instance secret or admin key', () => {
		const source = fs.readFileSync(backendChunk(), 'utf-8');
		expect(source).toContain('Instance secret: [REDACTED]');
		expect(source).toContain('Admin key:       [REDACTED]');
		expect(source).not.toContain('Instance secret: ${this.instanceSecret}');
		expect(source).not.toContain('Admin key:       ${this.adminKey}');
	});
});
