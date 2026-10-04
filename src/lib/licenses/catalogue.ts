import * as v from 'valibot';

// Public contract of the third-party notice catalogue. The build tool validates
// its output against this schema and the licenses page parses the fetched file
// with it, so both sides share one definition. Keep this module browser-safe:
// it must not import the build tooling or the SPDX license data.

export const CATALOGUE_JSON_FILE = 'third-party-licenses.json';
export const CATALOGUE_TEXT_FILE = 'third-party-licenses.txt';

const text = v.pipe(v.string(), v.minLength(1));
const httpUrl = v.pipe(v.string(), v.url(), v.regex(/^https?:\/\//i, 'Must be an http(s) URL.'));

const noticeSchema = v.strictObject({ label: text, text });

const entrySchema = v.pipe(
	v.strictObject({
		id: text,
		kind: v.picklist(['package', 'custom']),
		name: text,
		version: v.nullable(text),
		license: text,
		components: v.pipe(v.array(text), v.minLength(1)),
		sourceUrl: v.nullable(httpUrl),
		notices: v.pipe(v.array(noticeSchema), v.minLength(1))
	}),
	v.check(
		(entry) =>
			entry.kind === 'package'
				? entry.version !== null && entry.id === `npm:${entry.name}@${entry.version}`
				: /^custom:[a-z0-9][a-z0-9-]*$/.test(entry.id),
		'Entry id must match its kind, name, and version.'
	)
);

export const catalogueSchema = v.pipe(
	v.strictObject({
		schemaVersion: v.literal(1),
		entries: v.array(entrySchema)
	}),
	v.check(
		(catalogue) =>
			new Set(catalogue.entries.map((entry) => entry.id)).size === catalogue.entries.length,
		'Entry ids must be unique.'
	)
);

export type Catalogue = v.InferOutput<typeof catalogueSchema>;
export type CatalogueEntry = Catalogue['entries'][number];

// A line that starts a copyright statement, such as "Copyright 2023 Vercel, Inc."
// or "(c) Rich Harris". License boilerplate mentions copyright only mid-sentence.
const COPYRIGHT_LINE = /^\s*(?:copyright\b|\(c\)|©)/i;

const searchTexts = new WeakMap<CatalogueEntry, string[]>();

function searchFields(entry: CatalogueEntry): string[] {
	let fields = searchTexts.get(entry);
	if (!fields) {
		// Copyright lines name the holders, so "vercel" finds the AI SDK packages. The
		// rest of the notice text stays out: "mit" would match "permitted" everywhere.
		const holders = entry.notices.flatMap((notice) =>
			notice.text.split('\n').filter((line) => COPYRIGHT_LINE.test(line))
		);
		fields = [
			entry.name,
			entry.version ?? '',
			entry.license,
			entry.sourceUrl ?? '',
			...entry.components,
			...holders
		].map((field) => field.toLowerCase());
		searchTexts.set(entry, fields);
	}
	return fields;
}

/**
 * Case-insensitive substring search over the visible row fields, the source URL,
 * and the copyright lines of the notice texts.
 */
export function filterCatalogueEntries(
	entries: readonly CatalogueEntry[],
	query: string
): CatalogueEntry[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return [...entries];
	return entries.filter((entry) => searchFields(entry).some((field) => field.includes(needle)));
}
