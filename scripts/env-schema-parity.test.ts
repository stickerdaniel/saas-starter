import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Convex `env` block in `src/lib/convex/convex.config.ts` and the varlock
 * `.env-convex.schema` are two declarations of the same variable set. The env
 * block drives Convex's push-time validation and the generated typed `env`
 * object; the schema drives varlock codegen and the deploy-time presence check.
 * Its `@type=*` decorators coerce nothing on this path — no value here is loaded
 * by varlock — so they are documentation. The two must still agree on which vars
 * exist and which are required, or one source silently drifts from the other.
 *
 * Validator types intentionally differ (the schema's url/boolean vars are plain
 * strings in the env block, because Convex env values are always strings), so
 * this guard only checks the name set and the required/optional split.
 */

type VarMap = Map<string, { required: boolean }>;

/** Required var names + optionality from the varlock schema (decorator blocks). */
function parseSchema(): VarMap {
	const content = fs.readFileSync(
		path.resolve(import.meta.dirname, '..', '.env-convex.schema'),
		'utf-8'
	);
	const lines = content.split('\n');

	const headerEnd = lines.findIndex((line) => line.trim() === '# ---');
	expect(headerEnd, '.env-convex.schema: missing `# ---` header separator').toBeGreaterThan(-1);

	const vars: VarMap = new Map();
	let blockIsOptional = false;

	for (let i = headerEnd + 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line) {
			blockIsOptional = false;
			continue;
		}
		if (line.startsWith('#')) {
			if (line.includes('@optional')) blockIsOptional = true;
			continue;
		}
		const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
		if (match) {
			vars.set(match[1], { required: !blockIsOptional });
			blockIsOptional = false;
		}
	}
	return vars;
}

/** Var names + optionality from the `defineApp({ env: { ... } })` block. */
function parseEnvBlock(): VarMap {
	const content = fs.readFileSync(
		path.resolve(import.meta.dirname, '..', 'src/lib/convex/convex.config.ts'),
		'utf-8'
	);
	const blockMatch = content.match(/env:\s*\{([\s\S]*?)\n\t\}/);
	expect(blockMatch, 'env block not found in convex.config.ts').not.toBeNull();

	const vars: VarMap = new Map();
	for (const raw of blockMatch![1].split('\n')) {
		const line = raw.trim();
		if (!line || line.startsWith('//')) continue;
		const match = line.match(/^([A-Z_][A-Z0-9_]*):\s*(.+)$/);
		if (!match) continue;
		vars.set(match[1], { required: !match[2].startsWith('v.optional(') });
	}
	return vars;
}

describe('local capability profile ownership', () => {
	const viteSource = fs.readFileSync(
		path.resolve(import.meta.dirname, '..', 'vite.config.ts'),
		'utf-8'
	);

	it('strips a local-file profile and writes the launcher profile last', () => {
		expect(viteSource).toContain('CAPABILITY_PROFILE: _ignoredLocalCapabilityProfile');
		const localValues = viteSource.indexOf('...convexLocalEnv');
		const managedUpdates = viteSource.indexOf('...managedProviderUpdates', localValues);
		const launcherProfile = viteSource.indexOf("CAPABILITY_PROFILE: isTestMode ? 'test' : 'local'");
		expect(localValues).toBeGreaterThan(-1);
		expect(managedUpdates).toBeGreaterThan(localValues);
		expect(launcherProfile).toBeGreaterThan(managedUpdates);
	});

	it('does not inject provider dummies in test mode', () => {
		expect(viteSource).not.toContain('TEST_ONLY_ENV_PLACEHOLDERS');
		expect(viteSource).not.toContain('re_local_e2e_dummy');
		expect(viteSource).not.toContain('am_sk_local_e2e_dummy');
		expect(viteSource).not.toContain('sk-or-local-e2e-dummy');
	});
});

describe('Convex env declaration parity', () => {
	const schema = parseSchema();
	const envBlock = parseEnvBlock();

	it('schema is non-empty and was parsed', () => {
		expect(schema.size).toBeGreaterThan(0);
		expect(envBlock.size).toBeGreaterThan(0);
	});

	it('every schema var is declared in the env block', () => {
		const missing = [...schema.keys()].filter((name) => !envBlock.has(name));
		expect(
			missing,
			`vars in .env-convex.schema but missing from the env block: ${missing}`
		).toEqual([]);
	});

	it('every env-block var exists in the schema', () => {
		const extra = [...envBlock.keys()].filter((name) => !schema.has(name));
		expect(extra, `vars in the env block but missing from .env-convex.schema: ${extra}`).toEqual(
			[]
		);
	});

	it('required/optional status agrees for every var', () => {
		const mismatches = [...schema.entries()]
			.filter(([name, { required }]) => envBlock.get(name)?.required !== required)
			.map(([name, { required }]) => `${name}: schema ${required ? 'required' : 'optional'}`);
		expect(
			mismatches,
			`required/optional mismatch between schema and env block: ${mismatches}`
		).toEqual([]);
	});

	it('keeps only bootstrap auth inputs required at the declaration layer', () => {
		expect(
			[...envBlock.entries()]
				.filter(([, { required }]) => required)
				.map(([name]) => name)
				.sort()
		).toEqual(['BETTER_AUTH_SECRET', 'SITE_URL']);
	});

	it('declares exactly the managed provider values optional', () => {
		for (const name of [
			'RESEND_API_KEY',
			'AUTH_EMAIL',
			'EMAIL_ASSET_URL',
			'AUTUMN_SECRET_KEY',
			'OPENROUTER_API_KEY'
		]) {
			expect(envBlock.get(name)).toEqual({ required: false });
		}
		expect(envBlock.get('CAPABILITY_PROFILE')).toEqual({ required: false });
	});
});
