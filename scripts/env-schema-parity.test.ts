import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEST_ONLY_ENV_PLACEHOLDERS } from './local-convex-env';

/**
 * The Convex `env` block in `src/lib/convex/convex.config.ts` and the varlock
 * `.env-convex.schema` are two declarations of the same variable set. The env
 * block drives Convex's push-time validation and the generated typed `env`
 * object; the schema drives varlock typegen, log redaction, leak scanning, and
 * the `@type=url`/`@type=boolean` coercion. They must agree on which vars exist
 * and which are required, or one source silently drifts from the other.
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

	// A fresh `bun run dev:test` backend gets its env only from vite.config.ts:
	// auto-generated dev defaults, the TEST_ONLY_ENV_PLACEHOLDERS, and the
	// forwarded test secret. Any var convex.config.ts declares required but that
	// isn't provided here fails Convex's push-time validation, so a fresh worktree
	// can't boot e2e — and CI wouldn't catch it (it uses real preview-default env).
	it('every required env-block var is provided to a fresh local test backend', () => {
		// Always injected by vite.config.ts for a local backend (runtime values).
		const alwaysProvided = new Set([
			'BETTER_AUTH_SECRET',
			'SITE_URL',
			'LOCAL_CONVEX_DEV',
			'LOCAL_SEEDED_ADMIN_EMAIL',
			'LOCAL_SEEDED_ADMIN_PASSWORD',
			'LOCAL_SEEDED_ADMIN_NAME',
			'AUTH_E2E_TEST_SECRET'
		]);
		const provided = new Set([...alwaysProvided, ...Object.keys(TEST_ONLY_ENV_PLACEHOLDERS)]);

		const requiredButUnprovided = [...envBlock.entries()]
			.filter(([name, { required }]) => required && !provided.has(name))
			.map(([name]) => name);
		expect(
			requiredButUnprovided,
			`convex.config.ts requires these vars but a fresh local test backend isn't given them ` +
				`(add to TEST_ONLY_ENV_PLACEHOLDERS in scripts/local-convex-env.ts): ${requiredButUnprovided}`
		).toEqual([]);
	});
});
