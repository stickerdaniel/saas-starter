import * as v from 'valibot';
import {
	catalogueSchema,
	noticesText,
	type Catalogue,
	type CatalogueEntry
} from '../../src/lib/licenses/catalogue';

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** Locale-independent order with digit runs compared numerically (0.9.3 before 0.10.6). */
function naturalCompare(a: string, b: string): number {
	const left = a.toLowerCase().match(/\d+|\D+/g) ?? [];
	const right = b.toLowerCase().match(/\d+|\D+/g) ?? [];
	for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
		const [x, y] = [left[index]!, right[index]!];
		const order =
			/^\d/.test(x) && /^\d/.test(y) ? Number(x) - Number(y) || compare(x, y) : compare(x, y);
		if (order) return Math.sign(order);
	}
	return left.length - right.length || compare(a, b);
}

/**
 * Build the validated public catalogue. Entries are sorted by name, then
 * version, so the same inputs always produce identical bytes.
 */
export function buildCatalogue(entries: readonly CatalogueEntry[]): Catalogue {
	const sorted = [...entries].sort(
		(a, b) =>
			naturalCompare(a.name, b.name) ||
			naturalCompare(a.version ?? '', b.version ?? '') ||
			compare(a.id, b.id)
	);
	return v.parse(catalogueSchema, { schemaVersion: 1, entries: sorted });
}

export function serializeCatalogueJson(catalogue: Catalogue): string {
	return `${JSON.stringify(catalogue, null, '\t')}\n`;
}

export function serializeCatalogueText(catalogue: Catalogue): string {
	return noticesText(catalogue.entries);
}
