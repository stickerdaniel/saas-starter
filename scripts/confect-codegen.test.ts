import { spawnSync } from 'node:child_process';
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkoutLockPath, withCheckoutLock } from './checkout-lock';
import {
	CodegenError,
	CONFECT_GENERATED_DIR,
	CONVEX_DIR,
	confectCodegen,
	confectPreflight,
	manifest,
	withScratchCodegen,
	type Codegen
} from './confect-codegen';

const REPOSITORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TABLE = `import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';

export default Table.make(() => Schema.Struct({ text: Schema.String })).index('by_text', ['text']);
`;

const SPEC = `import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';

export default GroupSpec.make().addFunction(
	FunctionSpec.publicQuery({ name: 'count', returns: () => Schema.Number })
);
`;

const IMPL = `import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import databaseSchema from './_generated/schema';
import notes from './notes.spec';

const count = FunctionImpl.make(databaseSchema, notes, 'count', () => Effect.succeed(0));

export default GroupImpl.make(databaseSchema, notes).pipe(Layer.provide(count), GroupImpl.finalize);
`;

const PLAIN_DEFINITION = `import { queryGeneric } from 'convex/server';
import { v } from 'convex/values';

export const count = queryGeneric({ args: {}, returns: v.number(), handler: async () => 0 });
`;

const PLAIN_SPEC = `import { FunctionSpec, GroupSpec } from '@confect/core';
import type { count } from './notes';

export default GroupSpec.make().addFunction(FunctionSpec.convexPublicQuery<typeof count>()('count'));
`;

const PLAIN_IMPL = `import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from './_generated/schema';
import { count } from './notes';
import notes from './notes.spec';

export default GroupImpl.make(databaseSchema, notes).pipe(
	Layer.provide(FunctionImpl.make(databaseSchema, notes, 'count', count)),
	GroupImpl.finalize
);
`;

const NATIVE_REEXPORT = `export { count } from '../confect/notes';\n`;

const PROFILE_GATED_CONFIG = `import { defineApp } from 'convex/server';

if (process.env.CAPABILITY_PROFILE !== 'local') {
	throw new Error('CAPABILITY_PROFILE is ' + process.env.CAPABILITY_PROFILE);
}

export default defineApp();
`;

const APP_CONFIG = `import { defineApp } from 'convex/server';

export default defineApp();
`;

const PACKAGE_HELPER = `import * as Schema from 'effect/Schema';

export const label = Schema.String;
`;

const TABLE_WITH_PACKAGE_HELPER = `import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';
import { label } from '../../../../packages/fields/index';

export default Table.make(() => Schema.Struct({ label }));
`;

const AUTHORED_MODULE = 'export const authored = 1;\n';

const checkouts: string[] = [];

function preflight(root: string, options: { codegen?: Codegen } = {}) {
	return confectPreflight(root, { ...options, generateContent: () => {} });
}

function checkout({ git = true }: { git?: boolean } = {}): string {
	const root = mkdtempSync(path.join(tmpdir(), 'confect-codegen-checkout-'));
	checkouts.push(root);
	writeFileSync(
		path.join(root, 'package.json'),
		JSON.stringify({ name: 'fixture', private: true, type: 'module' })
	);
	writeFileSync(path.join(root, 'convex.json'), JSON.stringify({ functions: `${CONVEX_DIR}/` }));
	mkdirSync(path.join(root, CONVEX_DIR), { recursive: true });
	write(root, `${CONVEX_DIR}/convex.config.ts`, APP_CONFIG);
	write(root, 'src/lib/confect/tables/notes.ts', TABLE);
	write(root, '.gitignore', 'node_modules\n');
	symlinkSync(path.join(REPOSITORY, 'node_modules'), path.join(root, 'node_modules'), 'junction');
	if (git) runGit(root, ['init', '-q']);
	return root;
}

function runGit(root: string, args: string[]): void {
	const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
	if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
}

function linkedConvexDirectory(root: string): string {
	const outside = outsideDirectory();
	writeFileSync(path.join(outside, 'authored.ts'), 'ORIGINAL\n');
	rmSync(path.join(root, CONVEX_DIR), { recursive: true });
	symlinkSync(outside, path.join(root, CONVEX_DIR), 'junction');
	return outside;
}

const altersAuthored: Codegen = (scratch) => {
	write(scratch, `${CONFECT_GENERATED_DIR}/example.ts`, 'export const ok = true;\n');
	writeFileSync(path.join(scratch, CONVEX_DIR, 'authored.ts'), 'ALTERED\n');
};

function outsideDirectory(): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'confect-codegen-outside-'));
	checkouts.push(directory);
	return directory;
}

function appending(file: string, text: string): Codegen {
	return (scratch, profile) => {
		confectCodegen(scratch, profile);
		appendFileSync(path.join(scratch, file), text);
	};
}

function write(root: string, file: string, contents: string): void {
	mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
	writeFileSync(path.join(root, file), contents);
}

function plainGroup(root: string): void {
	write(root, 'src/lib/confect/notes.ts', PLAIN_DEFINITION);
	write(root, 'src/lib/confect/notes.spec.ts', PLAIN_SPEC);
	write(root, 'src/lib/confect/notes.impl.ts', PLAIN_IMPL);
	write(root, `${CONVEX_DIR}/notes.ts`, NATIVE_REEXPORT);
}

function generatedFiles(root: string): string[] {
	return [...manifest(path.join(root, CONFECT_GENERATED_DIR)).keys()];
}

afterEach(() => {
	for (const root of checkouts.splice(0)) {
		rmSync(checkoutLockPath(root), { force: true });
		rmSync(root, { recursive: true, force: true });
	}
});

describe('confect codegen preflight', () => {
	it('leaves no generated table wrapper behind after a table is renamed', async () => {
		const root = checkout();
		await preflight(root);
		expect(generatedFiles(root)).toContain('tables/notes.ts');

		renameSync(
			path.join(root, 'src/lib/confect/tables/notes.ts'),
			path.join(root, 'src/lib/confect/tables/memos.ts')
		);
		const result = await preflight(root);

		expect(generatedFiles(root)).toContain('tables/memos.ts');
		expect(generatedFiles(root)).not.toContain('tables/notes.ts');
		expect(result.removed).toContain(`${CONFECT_GENERATED_DIR}/tables/notes.ts`);
		expect(readFileSync(path.join(root, CONFECT_GENERATED_DIR, 'id.ts'), 'utf8')).not.toContain(
			'"notes"'
		);
	}, 60_000);

	it('leaves no generated group module behind after a group is removed', async () => {
		const root = checkout();
		write(root, 'src/lib/confect/notes.spec.ts', SPEC);
		write(root, 'src/lib/confect/notes.impl.ts', IMPL);
		await preflight(root);
		expect(generatedFiles(root)).toContain('registeredFunctions/notes.ts');

		rmSync(path.join(root, 'src/lib/confect/notes.spec.ts'));
		rmSync(path.join(root, 'src/lib/confect/notes.impl.ts'));
		await preflight(root);

		expect(generatedFiles(root).filter((file) => file.startsWith('registeredFunctions/'))).toEqual(
			[]
		);
	}, 60_000);

	it('removes a file the codegen no longer produces', async () => {
		const root = checkout();
		write(root, `${CONFECT_GENERATED_DIR}/stale/old.ts`, 'export {};\n');

		await preflight(root);

		expect(existsSync(path.join(root, CONFECT_GENERATED_DIR, 'stale'))).toBe(false);
	}, 60_000);

	it('fails when the codegen writes an unexpected JSON file into the functions directory', async () => {
		const root = checkout();
		const before = manifest(path.join(root, CONVEX_DIR));
		const writesJson: Codegen = (scratch, profile) => {
			confectCodegen(scratch, profile);
			writeFileSync(path.join(scratch, CONVEX_DIR, 'unexpected.json'), '{}');
		};

		await expect(preflight(root, { codegen: writesJson })).rejects.toThrow(
			`created ${CONVEX_DIR}/unexpected.json`
		);
		expect(manifest(path.join(root, CONVEX_DIR))).toEqual(before);
		expect(generatedFiles(root)).toEqual([]);
	}, 60_000);

	it('fails when the codegen changes convex.config.ts', async () => {
		const root = checkout();

		await expect(
			preflight(root, { codegen: appending(`${CONVEX_DIR}/convex.config.ts`, '\n') })
		).rejects.toThrow(`changed ${CONVEX_DIR}/convex.config.ts`);
		expect(generatedFiles(root)).toEqual([]);
	}, 60_000);

	it('fails when the codegen writes outside both write sets', async () => {
		const root = checkout();

		await expect(
			preflight(root, { codegen: appending('src/lib/confect/tables/notes.ts', '\n') })
		).rejects.toThrow('changed src/lib/confect/tables/notes.ts');
	}, 60_000);

	it('fails when the codegen changes an authored module in the functions directory', async () => {
		const root = checkout();
		write(root, `${CONVEX_DIR}/authored.ts`, AUTHORED_MODULE);

		await expect(preflight(root, { codegen: altersAuthored })).rejects.toThrow(
			`changed ${CONVEX_DIR}/authored.ts`
		);
		expect(generatedFiles(root)).toEqual([]);
	});

	it('lets the CLI replace the native module of a plain group with its generated module', async () => {
		const root = checkout();
		plainGroup(root);

		const generated = await withScratchCodegen(root, (scratch) =>
			readFileSync(path.join(scratch, CONVEX_DIR, 'notes.ts'), 'utf8')
		);

		expect(generated).toContain('export const count = registeredFunctions.count;');
		expect(readFileSync(path.join(root, CONVEX_DIR, 'notes.ts'), 'utf8')).toBe(NATIVE_REEXPORT);
	}, 60_000);

	it('fails when the codegen creates a module no group declares', async () => {
		const root = checkout();

		await expect(
			preflight(root, { codegen: appending(`${CONVEX_DIR}/stray.ts`, 'export {};\n') })
		).rejects.toThrow(`created ${CONVEX_DIR}/stray.ts`);
	}, 60_000);

	it('fails when the codegen deletes the module of a declared group', async () => {
		const root = checkout();
		plainGroup(root);
		const deletesGroup: Codegen = (scratch, profile) => {
			confectCodegen(scratch, profile);
			rmSync(path.join(scratch, CONVEX_DIR, 'notes.ts'));
		};

		await expect(preflight(root, { codegen: deletesGroup })).rejects.toThrow(
			`deleted ${CONVEX_DIR}/notes.ts`
		);
	}, 60_000);

	it('fails when the codegen writes no module for a declared group', async () => {
		const root = checkout();
		plainGroup(root);
		rmSync(path.join(root, CONVEX_DIR, 'notes.ts'));
		const skipsGroup: Codegen = (scratch, profile) => {
			confectCodegen(scratch, profile);
			rmSync(path.join(scratch, CONVEX_DIR, 'notes.ts'));
		};

		await expect(preflight(root, { codegen: skipsGroup })).rejects.toThrow(
			`missing ${CONVEX_DIR}/notes.ts`
		);
	}, 60_000);

	it('fails when the codegen leaves a declared group without its registration', async () => {
		const root = checkout();
		plainGroup(root);
		const dropsRegistration: Codegen = (scratch, profile) => {
			confectCodegen(scratch, profile);
			writeFileSync(path.join(scratch, CONVEX_DIR, 'notes.ts'), NATIVE_REEXPORT);
			rmSync(path.join(scratch, CONFECT_GENERATED_DIR, 'registeredFunctions', 'notes.ts'));
		};

		await expect(preflight(root, { codegen: dropsRegistration })).rejects.toThrow(
			`missing ${CONFECT_GENERATED_DIR}/registeredFunctions/notes.ts`
		);
	}, 60_000);

	it('refuses a linked functions directory in the checkout before the codegen runs', async () => {
		const root = checkout();
		const outside = linkedConvexDirectory(root);
		const codegen = vi.fn<Codegen>(altersAuthored);

		await expect(preflight(root, { codegen })).rejects.toThrow(
			`${path.join(root, CONVEX_DIR)} must be a real directory`
		);
		expect(codegen).not.toHaveBeenCalled();
		expect(readFileSync(path.join(outside, 'authored.ts'), 'utf8')).toBe('ORIGINAL\n');
	});

	it('refuses a linked functions directory in the scratch copy before the codegen runs', async () => {
		const root = checkout();
		const outside = outsideDirectory();
		writeFileSync(path.join(outside, 'authored.ts'), 'ORIGINAL\n');
		const linksConvex = (scratch: string) => {
			rmSync(path.join(scratch, CONVEX_DIR), { recursive: true });
			symlinkSync(outside, path.join(scratch, CONVEX_DIR), 'junction');
		};
		const codegen = vi.fn<Codegen>(altersAuthored);

		await expect(
			withScratchCodegen(root, () => undefined, { codegen, prepare: linksConvex })
		).rejects.toThrow(`${CONVEX_DIR} must be a real directory`);
		expect(codegen).not.toHaveBeenCalled();
		expect(readFileSync(path.join(outside, 'authored.ts'), 'utf8')).toBe('ORIGINAL\n');
	});

	it('generates in a checkout without Git, as a hosting build may run it', async () => {
		const root = checkout({ git: false });
		plainGroup(root);

		await preflight(root);

		expect(readFileSync(path.join(root, CONVEX_DIR, 'notes.ts'), 'utf8')).toContain(
			'export const count = registeredFunctions.count;'
		);
		expect(generatedFiles(root)).toContain('registeredFunctions/notes.ts');
	}, 60_000);

	it('refuses a .git entry that does not make the root a Git top level', async () => {
		const root = checkout({ git: false });
		writeFileSync(path.join(root, '.git'), 'gitdir: /nonexistent\n');
		const codegen = vi.fn<Codegen>(altersAuthored);

		await expect(preflight(root, { codegen })).rejects.toThrow(
			'is not the top level of a Git checkout'
		);
		expect(codegen).not.toHaveBeenCalled();
	});

	it.each([
		['a populated', true],
		['an unpopulated', false]
	])('refuses %s submodule in the Git index', async (_, populated) => {
		const root = checkout();
		if (populated) write(root, 'packages/submodule/input.ts', 'export const input = 1;\n');
		runGit(root, [
			'update-index',
			'--add',
			'--cacheinfo',
			`160000,${'1'.repeat(40)},packages/submodule`
		]);
		const codegen = vi.fn<Codegen>(altersAuthored);

		await expect(preflight(root, { codegen })).rejects.toThrow(
			'packages/submodule is a submodule in the Git index'
		);
		expect(codegen).not.toHaveBeenCalled();
	});

	it('leaves no temporary file behind when a generated file cannot replace a directory', async () => {
		const root = checkout();
		write(root, `${CONFECT_GENERATED_DIR}/example.ts/child.txt`, 'old\n');
		const writesExample: Codegen = (scratch) => {
			write(scratch, `${CONFECT_GENERATED_DIR}/example.ts`, 'export const ok = true;\n');
		};

		await expect(preflight(root, { codegen: writesExample })).rejects.toThrow();
		const live = readdirSync(path.join(root, CONFECT_GENERATED_DIR), { recursive: true });
		expect(live.filter((file) => String(file).endsWith('.codegen-tmp'))).toEqual([]);
	});

	it('fails when the codegen deletes an authored module and keeps it in the checkout', async () => {
		const root = checkout();
		write(root, `${CONVEX_DIR}/authored.ts`, AUTHORED_MODULE);

		await expect(preflight(root)).rejects.toThrow(`deleted ${CONVEX_DIR}/authored.ts`);
		expect(readFileSync(path.join(root, CONVEX_DIR, 'authored.ts'), 'utf8')).toBe(AUTHORED_MODULE);
	}, 60_000);

	it('removes the generated module of a removed group from the checkout', async () => {
		const root = checkout();
		plainGroup(root);
		await preflight(root);
		expect(existsSync(path.join(root, CONVEX_DIR, 'notes.ts'))).toBe(true);

		for (const file of ['notes.ts', 'notes.spec.ts', 'notes.impl.ts']) {
			rmSync(path.join(root, 'src/lib/confect', file));
		}
		const result = await preflight(root);

		expect(existsSync(path.join(root, CONVEX_DIR, 'notes.ts'))).toBe(false);
		expect(result.removed).toContain(`${CONVEX_DIR}/notes.ts`);
	}, 60_000);

	it('refuses a link in the generated tree and leaves its target unchanged', async () => {
		const root = checkout();
		write(root, 'src/lib/config/victim.ts', 'ORIGINAL\n');
		mkdirSync(path.join(root, CONFECT_GENERATED_DIR, 'tables'), { recursive: true });
		symlinkSync(
			'../../../config/victim.ts',
			path.join(root, CONFECT_GENERATED_DIR, 'tables/notes.ts')
		);

		await expect(preflight(root)).rejects.toBeInstanceOf(CodegenError);
		expect(readFileSync(path.join(root, 'src/lib/config/victim.ts'), 'utf8')).toBe('ORIGINAL\n');
	}, 60_000);

	it('refuses a link the codegen writes into the generated tree', async () => {
		const root = checkout();
		const outside = outsideDirectory();
		const writesLink: Codegen = (scratch, profile) => {
			confectCodegen(scratch, profile);
			symlinkSync(outside, path.join(scratch, CONFECT_GENERATED_DIR, 'linked'), 'junction');
		};

		await expect(preflight(root, { codegen: writesLink })).rejects.toThrow('linked');
		expect(generatedFiles(root)).toEqual([]);
	}, 60_000);

	it('refuses a generated directory that is a link', async () => {
		const root = checkout();
		const outside = outsideDirectory();
		writeFileSync(path.join(outside, 'keep.ts'), 'KEEP\n');
		symlinkSync(outside, path.join(root, CONFECT_GENERATED_DIR), 'junction');

		await expect(preflight(root)).rejects.toBeInstanceOf(CodegenError);
		expect(readdirSync(outside)).toEqual(['keep.ts']);
		expect(readFileSync(path.join(outside, 'keep.ts'), 'utf8')).toBe('KEEP\n');
	}, 60_000);

	it('resolves a table import from a root packages directory', async () => {
		const root = checkout();
		write(root, 'packages/fields/index.ts', PACKAGE_HELPER);
		write(root, 'src/lib/confect/tables/notes.ts', TABLE_WITH_PACKAGE_HELPER);

		await preflight(root);

		expect(generatedFiles(root)).toContain('tables/notes.ts');
	}, 60_000);

	it('evaluates convex.config.ts with the local capability profile only in the CLI', async () => {
		const root = checkout();
		write(root, `${CONVEX_DIR}/convex.config.ts`, PROFILE_GATED_CONFIG);
		vi.stubEnv('CAPABILITY_PROFILE', 'production');

		try {
			await preflight(root);
			expect(process.env.CAPABILITY_PROFILE).toBe('production');
		} finally {
			vi.unstubAllEnvs();
		}
		expect(generatedFiles(root)).toContain('components.ts');
	}, 60_000);

	it('refuses a root schema.ts in the Confect directory', async () => {
		const root = checkout();
		write(root, 'src/lib/confect/schema.ts', 'export default {};\n');
		const codegen = vi.fn<Codegen>();

		await expect(preflight(root, { codegen })).rejects.toBeInstanceOf(CodegenError);
		expect(codegen).not.toHaveBeenCalled();
	});

	it('waits for the checkout lock before it runs the codegen', async () => {
		const root = checkout();
		const codegen = vi.fn<Codegen>(confectCodegen);
		let pending: Promise<unknown> | undefined;

		await withCheckoutLock(root, async () => {
			pending = preflight(root, { codegen });
			await new Promise((resolve) => setTimeout(resolve, 300));
			expect(codegen).not.toHaveBeenCalled();
		});

		await pending;
		expect(codegen).toHaveBeenCalledTimes(1);
		expect(existsSync(checkoutLockPath(root))).toBe(false);
	}, 60_000);
});
