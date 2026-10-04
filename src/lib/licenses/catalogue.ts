import * as v from 'valibot';

// Public contract of the third-party notice catalogue. The build tool validates
// its output against this schema, and again before it hands the catalogue to the
// server build that renders the licenses page. Keep this module browser-safe: the
// page searches with it, so it must not import the build tooling or SPDX data.

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

/** Case- and whitespace-insensitive form that queries and indexed texts share. */
function normalize(text: string): string {
	return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

interface SearchIndex {
	/** Row fields that match anywhere: "2.0" finds "Apache-2.0". */
	fields: string[];
	/** All notice texts, which match only at word starts. */
	notices: string;
}

const searchIndexes = new WeakMap<CatalogueEntry, SearchIndex>();

function searchIndex(entry: CatalogueEntry): SearchIndex {
	let index = searchIndexes.get(entry);
	if (!index) {
		index = {
			fields: [
				entry.name,
				entry.version ?? '',
				entry.license,
				entry.sourceUrl ?? '',
				...entry.components
			].map(normalize),
			notices: entry.notices.map((notice) => normalize(notice.text)).join('\n')
		};
		searchIndexes.set(entry, index);
	}
	return index;
}

const WORD_CHARACTER = /^[\p{L}\p{M}\p{N}]$/u;

/** The code point that ends right before `index`. */
function previousCharacter(text: string, index: number): string {
	return Array.from(text.slice(Math.max(0, index - 2), index)).at(-1) ?? '';
}

/**
 * Whether `needle` occurs in `text` where a word starts, so "mit" finds "MIT" and
 * not "permitted". A needle that starts with punctuation, like "(c)", matches anywhere.
 */
function includesAtWordStart(text: string, needle: string): boolean {
	if (!WORD_CHARACTER.test(Array.from(needle)[0] ?? '')) return text.includes(needle);
	for (let index = text.indexOf(needle); index !== -1; index = text.indexOf(needle, index + 1)) {
		if (!WORD_CHARACTER.test(previousCharacter(text, index))) return true;
	}
	return false;
}

/**
 * Case-insensitive literal search. The name, version, license, source URL, and
 * component labels match anywhere; notice texts match at word starts, which finds
 * copyright holders such as "vercel" without "mit" matching "permitted".
 *
 * @param componentLabel Displayed label of a component key, so searches in the
 *   active locale find it; the raw key matches too.
 */
export function filterCatalogueEntries(
	entries: readonly CatalogueEntry[],
	query: string,
	componentLabel: (component: string) => string = (component) => component
): CatalogueEntry[] {
	const needle = normalize(query);
	if (!needle) return [...entries];
	return entries.filter((entry) => {
		const index = searchIndex(entry);
		return (
			index.fields.some((field) => field.includes(needle)) ||
			entry.components.some((component) => normalize(componentLabel(component)).includes(needle)) ||
			includesAtWordStart(index.notices, needle)
		);
	});
}
