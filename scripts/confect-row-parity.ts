import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Table } from '@confect/core';
import { ConvexBackend } from 'convex-vite-plugin/lib';
import type { ObjectFieldType, ValidatorJSON } from 'convex/values';
import * as Exit from 'effect/Exit';
import * as Schema from 'effect/Schema';
import { CONFECT_GENERATED_DIR, CONVEX_DIR } from './confect-codegen';
import { LOCAL_CONVEX_BINARY_VERSION } from './local-convex-binary';

type Value =
	null | boolean | number | string | readonly Value[] | { readonly [key: string]: Value };

type TableExport = { tableName: string; documentType: ValidatorJSON };

type RowReport = { lines: string[]; failures: string[] };

const SCHEDULED_FUNCTIONS = '_scheduled_functions';

const PARITY_MODULE = `import { makeFunctionReference, mutationGeneric, queryGeneric } from 'convex/server';
import { v } from 'convex/values';

export const insert = mutationGeneric({
	args: { table: v.string(), document: v.any() },
	handler: (ctx, { table, document }) => ctx.db.insert(table, document)
});

export const list = queryGeneric({
	args: { table: v.string() },
	handler: (ctx, { table }) => ctx.db.query(table).collect()
});

export const noop = mutationGeneric({ args: {}, handler: async () => null });

export const schedule = mutationGeneric({
	args: {},
	handler: (ctx) => ctx.scheduler.runAfter(86_400_000, makeFunctionReference('parity:noop'))
});
`;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValue(value: unknown): value is Value {
	if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) return true;
	if (Array.isArray(value)) return value.every(isValue);
	return isRecord(value) && Object.values(value).every(isValue);
}

function isDocCodec(value: unknown): value is Schema.Codec<unknown, unknown> {
	return Schema.isSchema(value);
}

function stable(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
	if (isRecord(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

function unionWidth(validator: ValidatorJSON): number {
	switch (validator.type) {
		case 'union':
			return Math.max(validator.value.length, ...validator.value.map(unionWidth));
		case 'object':
			return Math.max(
				1,
				...Object.values(validator.value).map((field) => unionWidth(field.fieldType))
			);
		case 'array':
			return unionWidth(validator.value);
		case 'record':
			return unionWidth(validator.values.fieldType);
		default:
			return 1;
	}
}

function referencedTables(validator: ValidatorJSON): string[] {
	switch (validator.type) {
		case 'id':
			return [validator.tableName];
		case 'union':
			return validator.value.flatMap(referencedTables);
		case 'object':
			return Object.values(validator.value).flatMap((field) => referencedTables(field.fieldType));
		case 'array':
			return referencedTables(validator.value);
		case 'record':
			return referencedTables(validator.values.fieldType);
		default:
			return [];
	}
}

export function sampleValue(
	validator: ValidatorJSON,
	variant: number,
	withOptionals: boolean,
	idFor: (tableName: string) => string
): Value {
	switch (validator.type) {
		case 'null':
			return null;
		case 'number':
			return variant + 0.5;
		case 'boolean':
			return variant % 2 === 0;
		case 'string':
			return `sample-${variant}`;
		case 'any':
			return { sample: variant };
		case 'literal':
			if (!isValue(validator.value)) throw new Error('Unsupported literal value.');
			return validator.value;
		case 'id':
			return idFor(validator.tableName);
		case 'array':
			return [sampleValue(validator.value, variant, withOptionals, idFor)];
		case 'record':
			return { key: sampleValue(validator.values.fieldType, variant, withOptionals, idFor) };
		case 'object':
			return Object.fromEntries(
				Object.entries(validator.value)
					.filter(([, field]: [string, ObjectFieldType]) => withOptionals || !field.optional)
					.map(([name, field]) => [
						name,
						sampleValue(field.fieldType, variant, withOptionals, idFor)
					])
			);
		case 'union': {
			const member = validator.value[variant % validator.value.length];
			if (!member) throw new Error('Empty union.');
			return sampleValue(member, variant, withOptionals, idFor);
		}
		default:
			throw new Error(`No sample for validator type ${validator.type}.`);
	}
}

export function sampleRows(
	documentType: ValidatorJSON,
	idFor: (tableName: string) => string
): Value[] {
	const rows: Value[] = [];
	for (let variant = 0; variant < unionWidth(documentType); variant++) {
		for (const withOptionals of [false, true]) {
			rows.push(sampleValue(documentType, variant, withOptionals, idFor));
		}
	}
	return rows;
}

function tableExports(schema: unknown): TableExport[] {
	if (!isRecord(schema) || typeof schema.export !== 'function') {
		throw new Error('The authored schema has no export().');
	}
	const exported: unknown = JSON.parse(String(schema.export()));
	if (!isRecord(exported) || !Array.isArray(exported.tables)) {
		throw new Error('The authored schema export has no tables.');
	}
	return exported.tables.map((table: unknown): TableExport => {
		if (!isRecord(table) || typeof table.tableName !== 'string' || !isRecord(table.documentType)) {
			throw new Error('Unexpected table export.');
		}
		const documentType: ValidatorJSON = JSON.parse(JSON.stringify(table.documentType));
		return { tableName: table.tableName, documentType };
	});
}

function orderByReferences(tables: readonly TableExport[]): TableExport[] {
	const ordered: TableExport[] = [];
	const visit = (table: TableExport, trail: ReadonlySet<string>) => {
		if (ordered.includes(table)) return;
		if (trail.has(table.tableName)) throw new Error(`Id cycle at ${table.tableName}.`);
		for (const name of referencedTables(table.documentType)) {
			const target = tables.find((candidate) => candidate.tableName === name);
			if (target && target !== table) visit(target, new Set([...trail, table.tableName]));
		}
		ordered.push(table);
	};
	for (const table of tables) visit(table, new Set());
	return ordered;
}

async function freePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	await new Promise<void>((resolve) => server.close(() => resolve()));
	if (!address || typeof address === 'string') throw new Error('No free port.');
	return address.port;
}

function deployDirectory(root: string): string {
	const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'confect-row-parity-')));
	const convex = path.join(directory, 'convex');
	mkdirSync(convex);
	writeFileSync(
		path.join(directory, 'package.json'),
		JSON.stringify({
			name: 'confect-row-parity',
			private: true,
			type: 'module',
			dependencies: { convex: '*' }
		})
	);
	const authored = path
		.relative(convex, path.join(root, CONVEX_DIR, 'schema'))
		.split(path.sep)
		.join('/');
	writeFileSync(path.join(convex, 'schema.ts'), `export { default } from '${authored}';\n`);
	writeFileSync(path.join(convex, 'parity.ts'), PARITY_MODULE);
	symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'junction');
	return directory;
}

function deploy(directory: string, url: string, adminKey: string): void {
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([name]) => !name.startsWith('CONVEX_'))
	);
	const result = spawnSync(
		process.versions.bun ? process.execPath : 'bun',
		[
			path.join(directory, 'node_modules/convex/bin/main.js'),
			'deploy',
			'--url',
			url,
			'--admin-key',
			adminKey,
			'--typecheck',
			'disable',
			'--codegen',
			'disable'
		],
		{ cwd: directory, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }
	);
	if (result.status !== 0) {
		throw new Error(`convex deploy failed:\n${result.stdout}${result.stderr}`);
	}
}

async function loadDocCodec(
	root: string,
	tableName: string
): Promise<Schema.Codec<unknown, unknown>> {
	const file = path.join(root, CONFECT_GENERATED_DIR, 'tables', `${tableName}.ts`);
	const module: { default?: unknown } = await import(pathToFileURL(file).href);
	const table = module.default;
	if (!Table.isTable(table) || !('Doc' in table) || !isDocCodec(table.Doc)) {
		throw new Error(`${file} does not default-export a Confect table.`);
	}
	return table.Doc;
}

export async function checkStoredRows(root: string): Promise<RowReport> {
	const schemaModule: { default?: unknown } = await import(
		pathToFileURL(path.join(root, CONVEX_DIR, 'schema.ts')).href
	);
	const tables = orderByReferences(tableExports(schemaModule.default));
	const directory = deployDirectory(root);
	const backend = new ConvexBackend(
		{
			projectDir: directory,
			port: await freePort(),
			siteProxyPort: await freePort(),
			binaryVersion: LOCAL_CONVEX_BINARY_VERSION,
			stdio: 'ignore'
		},
		'silent'
	);
	const report: RowReport = { lines: [], failures: [] };
	try {
		await backend.startBackend(path.join(directory, 'backend'));
		deploy(directory, backend.backendUrl ?? '', backend.getAdminKey());
		const call = async (name: string, args: Record<string, Value>): Promise<unknown> =>
			backend.runFunction(name, args);
		const ids = new Map<string, string>();
		const scheduled = await call('parity:schedule', {});
		if (typeof scheduled !== 'string') throw new Error('parity:schedule returned no id.');
		ids.set(SCHEDULED_FUNCTIONS, scheduled);
		const idFor = (tableName: string) => {
			const id = ids.get(tableName);
			if (!id) throw new Error(`No stored ${tableName} row to reference.`);
			return id;
		};
		for (const table of tables) {
			const rows = sampleRows(table.documentType, idFor);
			for (const row of rows) {
				const id = await call('parity:insert', { table: table.tableName, document: row });
				if (typeof id !== 'string')
					throw new Error(`Insert into ${table.tableName} returned no id.`);
				if (!ids.has(table.tableName)) ids.set(table.tableName, id);
			}
			const stored = await call('parity:list', { table: table.tableName });
			if (!Array.isArray(stored) || stored.length !== rows.length) {
				report.failures.push(
					`${table.tableName}: ${rows.length} rows inserted, read back ${String(Array.isArray(stored) ? stored.length : stored)}`
				);
				continue;
			}
			const doc = await loadDocCodec(root, table.tableName);
			const decode = Schema.decodeUnknownExit(doc);
			const encode = Schema.encodeUnknownExit(doc);
			let decoded = 0;
			for (const [index, row] of stored.entries()) {
				const result = decode(row);
				if (Exit.isFailure(result)) {
					report.failures.push(`${table.tableName} row ${index}: ${String(result.cause)}`);
					continue;
				}
				const encoded = encode(result.value);
				if (Exit.isFailure(encoded) || stable(encoded.value) !== stable(row)) {
					report.failures.push(
						`${table.tableName} row ${index}: encodes to a different stored value`
					);
					continue;
				}
				decoded++;
			}
			report.lines.push(
				`${table.tableName}: ${decoded}/${stored.length} stored rows decode and re-encode unchanged`
			);
		}
	} finally {
		await backend.stop(false);
		rmSync(directory, { recursive: true, force: true });
	}
	return report;
}
