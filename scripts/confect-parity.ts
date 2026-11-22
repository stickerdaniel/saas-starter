#!/usr/bin/env bun
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	CONFECT_GENERATED_DIR,
	CONVEX_DIR,
	manifest,
	manifestDifference,
	withScratchCodegen,
	type CapabilityProfile,
	type ScratchOptions
} from './confect-stage';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

type ExportableSchema = { export(): string };

function isExportableSchema(value: unknown): value is ExportableSchema {
	return (
		typeof value === 'object' &&
		value !== null &&
		'export' in value &&
		typeof value.export === 'function'
	);
}

async function exportSchema(file: string): Promise<Json> {
	const module: { default?: unknown } = await import(pathToFileURL(file).href);
	if (!isExportableSchema(module.default)) {
		throw new Error(`${file} does not default-export a Convex schema definition.`);
	}
	const exported: Json = JSON.parse(module.default.export());
	return exported;
}

function isRecord(value: Json): value is { readonly [key: string]: Json } {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortBy(items: Json, key: string): Json {
	if (!Array.isArray(items)) return items;
	const label = (item: Json) => (isRecord(item) ? String(item[key]) : JSON.stringify(item));
	return [...items].sort((a, b) => (label(a) < label(b) ? -1 : label(a) > label(b) ? 1 : 0));
}

const KEYED_ARRAYS: Readonly<Record<string, string>> = {
	tables: 'tableName',
	indexes: 'indexDescriptor',
	stagedDbIndexes: 'indexDescriptor',
	searchIndexes: 'indexDescriptor',
	stagedSearchIndexes: 'indexDescriptor',
	vectorIndexes: 'indexDescriptor',
	stagedVectorIndexes: 'indexDescriptor'
};

export function normalizeSchema(value: Json): Json {
	if (Array.isArray(value)) return value.map(normalizeSchema);
	if (!isRecord(value)) return value;
	const entries = Object.keys(value)
		.sort()
		.map((key): [string, Json] => {
			const child = value[key] ?? null;
			const keyedBy = KEYED_ARRAYS[key];
			return [key, normalizeSchema(keyedBy ? sortBy(child, keyedBy) : child)];
		});
	return Object.fromEntries(entries);
}

function labelOf(item: Json, index: number): string {
	if (isRecord(item)) {
		for (const key of ['tableName', 'indexDescriptor']) {
			const label = item[key];
			if (typeof label === 'string') return label;
		}
	}
	return String(index);
}

export function schemaDifferences(expected: Json, actual: Json, at = '$'): string[] {
	if (Array.isArray(expected) && Array.isArray(actual)) {
		const differences: string[] = [];
		if (expected.length !== actual.length) {
			differences.push(`${at}: ${expected.length} entries expected, ${actual.length} found`);
		}
		const length = Math.min(expected.length, actual.length);
		for (let index = 0; index < length; index++) {
			differences.push(
				...schemaDifferences(
					expected[index] ?? null,
					actual[index] ?? null,
					`${at}[${labelOf(expected[index] ?? null, index)}]`
				)
			);
		}
		return differences;
	}
	if (isRecord(expected) && isRecord(actual)) {
		const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
		return keys.flatMap((key) => {
			if (!(key in actual)) return [`${at}.${key}: missing from the Confect schema`];
			if (!(key in expected)) return [`${at}.${key}: not in the authored schema`];
			return schemaDifferences(expected[key] ?? null, actual[key] ?? null, `${at}.${key}`);
		});
	}
	return JSON.stringify(expected) === JSON.stringify(actual)
		? []
		: [`${at}: authored ${JSON.stringify(expected)}, Confect ${JSON.stringify(actual)}`];
}

export type SchemaParity = {
	authored: Json;
	confect: Json;
	differences: readonly string[];
};

export async function checkSchemaParity(
	root: string,
	options: ScratchOptions = {}
): Promise<SchemaParity> {
	const authored = normalizeSchema(await exportSchema(path.join(root, CONVEX_DIR, 'schema.ts')));
	const confect = await withScratchCodegen(
		root,
		async (scratch) =>
			normalizeSchema(
				await exportSchema(path.join(scratch, CONFECT_GENERATED_DIR, 'convexSchema.ts'))
			),
		options
	);
	return { authored, confect, differences: schemaDifferences(authored, confect) };
}

const PROFILES: readonly CapabilityProfile[] = ['local', 'test'];

export async function checkProfileParity(
	root: string,
	options: ScratchOptions = {}
): Promise<string[]> {
	const outputs = await Promise.all(
		PROFILES.map((profile) =>
			withScratchCodegen(
				root,
				(scratch) => ({
					confect: manifest(path.join(scratch, CONFECT_GENERATED_DIR)),
					convex: manifest(path.join(scratch, CONVEX_DIR))
				}),
				{ ...options, profile }
			)
		)
	);
	const [local, test] = outputs;
	if (!local || !test) throw new Error('Both profiles must produce an output.');
	return [
		...manifestDifference(local.confect, test.confect).map(
			(file) => `${CONFECT_GENERATED_DIR}/${file}`
		),
		...manifestDifference(local.convex, test.convex).map((file) => `${CONVEX_DIR}/${file}`)
	];
}

function summarize(schema: Json): string {
	if (!isRecord(schema) || !Array.isArray(schema.tables)) return 'no tables';
	let indexes = 0;
	let searchIndexes = 0;
	for (const table of schema.tables) {
		if (!isRecord(table)) continue;
		if (Array.isArray(table.indexes)) indexes += table.indexes.length;
		if (Array.isArray(table.searchIndexes)) searchIndexes += table.searchIndexes.length;
	}
	return `${schema.tables.length} tables, ${indexes} indexes, ${searchIndexes} search indexes`;
}

async function main(checks: readonly string[]): Promise<number> {
	const selected = checks.length === 0 ? ['schema', 'profiles'] : checks;
	let failed = false;
	for (const check of selected) {
		if (check === 'schema') {
			const parity = await checkSchemaParity(PROJECT_ROOT);
			console.log(`authored schema: ${summarize(parity.authored)}`);
			console.log(`Confect schema:  ${summarize(parity.confect)}`);
			if (parity.differences.length > 0) {
				failed = true;
				console.error('The Confect tables do not generate the authored schema:');
				for (const difference of parity.differences) console.error(`  ${difference}`);
			} else {
				console.log('The Confect tables generate the authored schema.');
			}
		} else if (check === 'profiles') {
			const differences = await checkProfileParity(PROJECT_ROOT);
			if (differences.length > 0) {
				failed = true;
				console.error('Codegen output differs between CAPABILITY_PROFILE local and test:');
				for (const file of differences) console.error(`  ${file}`);
			} else {
				console.log('Codegen output is equal for CAPABILITY_PROFILE local and test.');
			}
		} else if (check === 'rows') {
			const { checkStoredRows } = await import('./confect-row-parity');
			const report = await checkStoredRows(PROJECT_ROOT);
			for (const line of report.lines) console.log(line);
			if (report.failures.length > 0) {
				failed = true;
				for (const failure of report.failures) console.error(`  ${failure}`);
			}
		} else {
			console.error(`Unknown check "${check}". Use schema, profiles or rows.`);
			return 2;
		}
	}
	return failed ? 1 : 0;
}

if (import.meta.main) {
	process.exit(await main(process.argv.slice(2)));
}
