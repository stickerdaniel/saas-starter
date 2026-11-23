import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { required } from './required';

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

const ROOT = path.resolve(import.meta.dirname, '..');

type VarMap = Map<string, { required: boolean }>;

/** Required var names + optionality from the varlock schema (decorator blocks). */
function parseSchema(content: string): VarMap {
	const lines = content.split('\n');

	const headerEnd = lines.findIndex((line) => line.trim() === '# ---');
	expect(headerEnd, '.env-convex.schema: missing `# ---` header separator').toBeGreaterThan(-1);

	const vars: VarMap = new Map();
	let blockIsOptional = false;

	for (const raw of lines.slice(headerEnd + 1)) {
		const line = raw.trim();
		if (!line) {
			blockIsOptional = false;
			continue;
		}
		if (line.startsWith('#')) {
			if (line.includes('@optional')) blockIsOptional = true;
			continue;
		}
		const [, name] = line.match(/^([A-Z_][A-Z0-9_]*)=/) ?? [];
		if (name !== undefined) {
			vars.set(name, { required: !blockIsOptional });
			blockIsOptional = false;
		}
	}
	return vars;
}

/** Var names + optionality from the `defineApp({ env: { ... } })` block. */
function parseEnvBlock(content: string): VarMap {
	const blockMatch = content.match(/env:\s*\{([\s\S]*?)\n\t\}/);
	expect(blockMatch, 'env block not found in convex.config.ts').not.toBeNull();

	const vars: VarMap = new Map();
	for (const raw of required(blockMatch?.[1], 'env block body').split('\n')) {
		const line = raw.trim();
		if (!line || line.startsWith('//')) continue;
		const [, name, validator] = line.match(/^([A-Z_][A-Z0-9_]*):\s*(.+)$/) ?? [];
		if (name === undefined || validator === undefined) continue;
		vars.set(name, { required: !validator.startsWith('v.optional(') });
	}
	return vars;
}

/** Vars whose required/optional status differs between the schema and the env block. */
function requirednessMismatches(schema: VarMap, envBlock: VarMap): string[] {
	return [...schema.entries()]
		.filter(([name, { required }]) => envBlock.get(name)?.required !== required)
		.map(([name, { required }]) => `${name}: schema ${required ? 'required' : 'optional'}`);
}

describe('Convex env declaration parity', () => {
	const schemaText = fs.readFileSync(path.join(ROOT, '.env-convex.schema'), 'utf-8');
	const configText = fs.readFileSync(path.join(ROOT, 'src/lib/convex/convex.config.ts'), 'utf-8');
	const schema = parseSchema(schemaText);
	const envBlock = parseEnvBlock(configText);

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
		const mismatches = requirednessMismatches(schema, envBlock);
		expect(
			mismatches,
			`required/optional mismatch between schema and env block: ${mismatches}`
		).toEqual([]);
	});

	it('rejects an env block that makes a required var optional', () => {
		const corrupted = configText.replace(
			'SITE_URL: v.string()',
			'SITE_URL: v.optional(v.string())'
		);
		expect(corrupted).not.toBe(configText);
		expect(requirednessMismatches(schema, parseEnvBlock(corrupted))).toEqual([
			'SITE_URL: schema required'
		]);
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
