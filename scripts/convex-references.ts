import type { Visibility } from './convex-surface';

export type Reference = { identifier: string; visibility: Visibility; file: string };

// Direct generated-api access uses JavaScript identifiers, not ASCII words.
// `$` is common in generated/user code, and ECMAScript permits Unicode
// ID_Start/ID_Continue characters plus ZWNJ/ZWJ in continuations. Bracket
// notation and dynamically assembled references remain deliberately outside
// this floor (documented by the compatibility check).
const IDENTIFIER_START = String.raw`[$_\p{ID_Start}]`;
const JOIN_CONTINUATIONS = String.fromCodePoint(0x200c, 0x200d);
const IDENTIFIER_CONTINUE = `[$_${JOIN_CONTINUATIONS}\\p{ID_Continue}]`;
const IDENTIFIER = `${IDENTIFIER_START}${IDENTIFIER_CONTINUE}*`;
const DIRECT_REFERENCE = new RegExp(
	String.raw`\b(api|internal)\.((?:${IDENTIFIER}\.)+${IDENTIFIER})`,
	'gu'
);

/** `api.admin.queries.listUsers` -> `admin/queries:listUsers`. */
export function identifiersIn(source: string, file: string): Reference[] {
	const found: Reference[] = [];
	for (const match of source.matchAll(DIRECT_REFERENCE)) {
		const parts = match[2]!.split('.');
		const fn = parts.pop()!;
		if (parts.length === 0) continue;
		found.push({
			identifier: `${parts.join('/')}:${fn}`,
			visibility: match[1] === 'api' ? 'public' : 'internal',
			file
		});
	}
	return found;
}
