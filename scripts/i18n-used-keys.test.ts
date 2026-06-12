import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../src/i18n/en.json';

// Every translation key referenced as a string literal in code must exist in
// en.json — a missing key renders as the raw key string in production (the
// Tolgee <T> component, $t() and the Convex t() helper all fall back to the
// key itself). locale-parity.test.ts guarantees de/es/fr mirror en.json, so
// checking against en.json covers all locales.
//
// LIMITATION: this is regex-level extraction of LITERAL references only.
// Dynamic keys are silently skipped because they cannot be resolved
// statically: identifiers (keyName={item.translationKey}), ternaries
// (keyName={cond ? 'a' : 'b'}), template literals ($t(`a.${x}`)), and
// Svelte-interpolated attributes (keyName="pricing.features.free.{key}").

const SCAN_ROOT = path.resolve('src');
// src/i18n holds the locale JSON files themselves, not key references.
const EXCLUDED_DIRS = new Set([path.join(SCAN_ROOT, 'i18n')]);
const CONVEX_ROOT = path.join(SCAN_ROOT, 'lib', 'convex');

// <T keyName="..."> static attribute, plus the expression forms
// keyName={'...'} and keyName={"..."}.
const KEYNAME_ATTR = /keyName=(?:"([^"\n]*)"|\{\s*'([^'\n]*)'\s*\}|\{\s*"([^"\n]*)"\s*\})/g;

// Tolgee translate store: $t('key') / $t("key"). The key is the first
// argument; a params object may follow and the call may span lines.
const TOLGEE_T = /\$t\(\s*(?:'([^'\n]*)'|"([^"\n]*)")/g;

// Convex backend helper from src/lib/convex/i18n/translations.ts:
// t(locale, 'key', params?) — the key is the SECOND argument. The first
// argument is a locale literal ('de'), an identifier (locale, data.locale),
// or a single call (extractLocaleFromUrl(pageUrl)). The negative lookbehind
// keeps this from matching insert(, import(, $t(, foo.t( etc. Only applied
// under src/lib/convex/ where the helper lives.
const CONVEX_T =
	/(?<![\w$.])t\(\s*(?:['"][a-z]{2}['"]|[\w.$]+(?:\([^()]*\))?)\s*,\s*(?:'([^'\n]*)'|"([^"\n]*)")/g;

// Two resolution semantics, mirroring the two runtimes:
// - 'tolgee' (<T keyName>, $t): Tolgee flattens structured JSON by joining
//   nested object keys with dots, so mixed flat/nested entries both resolve.
//   en.json contains flat dotted keys (e.g. "signup.title" inside "auth",
//   forced by "auth.signup" also existing as a string leaf) that are valid
//   full keys at runtime.
// - 'convex' (t(locale, key)): getNestedValue() in translations.ts resolves
//   strictly by nested path, so flat dotted keys would NOT resolve there.
type Semantics = 'tolgee' | 'convex';

interface KeyRef {
	key: string;
	file: string;
	line: number;
	semantics: Semantics;
}

function isScannable(file: string): boolean {
	if (file.endsWith('.test.ts') || file.endsWith('.spec.ts')) return false;
	// .ts also covers .svelte.ts rune modules.
	return file.endsWith('.svelte') || file.endsWith('.ts');
}

// Plain sorted fs walk — deterministic order, no glob dependency.
function walk(dir: string, out: string[] = []): string[] {
	const entries = fs
		.readdirSync(dir, { withFileTypes: true })
		.sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			// _generated: Convex codegen and built email templates.
			if (entry.name === '_generated' || EXCLUDED_DIRS.has(full)) continue;
			walk(full, out);
		} else if (entry.isFile() && isScannable(full)) {
			out.push(full);
		}
	}
	return out;
}

function lineOfIndex(content: string, index: number): number {
	let line = 1;
	for (let i = 0; i < index; i++) {
		if (content.charCodeAt(i) === 10) line++;
	}
	return line;
}

function extractRefs(
	content: string,
	file: string,
	patterns: Array<[RegExp, Semantics]>
): KeyRef[] {
	const refs: KeyRef[] = [];
	for (const [pattern, semantics] of patterns) {
		for (const match of content.matchAll(pattern)) {
			const key = match.slice(1).find((group) => group !== undefined);
			if (key === undefined || key === '') continue;
			// Svelte attribute interpolation (keyName="a.{key}") is dynamic.
			if (key.includes('{') || key.includes('}')) continue;
			refs.push({ key, file, line: lineOfIndex(content, match.index), semantics });
		}
	}
	return refs;
}

function collectKeyRefs(): KeyRef[] {
	const refs: KeyRef[] = [];
	for (const file of walk(SCAN_ROOT)) {
		const content = fs.readFileSync(file, 'utf-8');
		const patterns: Array<[RegExp, Semantics]> = [
			[KEYNAME_ATTR, 'tolgee'],
			[TOLGEE_T, 'tolgee']
		];
		if (file.startsWith(CONVEX_ROOT + path.sep)) patterns.push([CONVEX_T, 'convex']);
		refs.push(...extractRefs(content, path.relative(process.cwd(), file), patterns));
	}
	return refs;
}

// All full key names a Tolgee runtime can resolve: nested object keys joined
// with dots, leaves must be strings. Flat dotted keys flatten identically.
function flattenLeafKeys(value: unknown, prefix: string, out: Set<string>): Set<string> {
	if (typeof value === 'string') {
		out.add(prefix);
	} else if (value !== null && typeof value === 'object') {
		for (const [key, child] of Object.entries(value)) {
			flattenLeafKeys(child, prefix ? `${prefix}.${key}` : key, out);
		}
	}
	return out;
}

// Mirrors getNestedValue() in src/lib/convex/i18n/translations.ts: a key only
// renders a translation when its dot-path resolves step by step to a string
// leaf. A path that ends on a nested object is as broken as a missing one.
function resolvesToStringLeaf(obj: Record<string, unknown>, key: string): boolean {
	const result = key.split('.').reduce<unknown>((current, part) => {
		if (current && typeof current === 'object' && part in current) {
			return (current as Record<string, unknown>)[part];
		}
		return undefined;
	}, obj);
	return typeof result === 'string';
}

describe('i18n used keys', () => {
	const refs = collectKeyRefs();

	it('finds literal key references in src', () => {
		// Sanity floor: the repo has hundreds of literal references. If the walk
		// or the regexes break, this fails instead of the main assertion passing
		// vacuously on an empty set.
		expect(refs.length).toBeGreaterThan(100);
	});

	it('every literal key reference resolves to a string leaf in en.json', () => {
		const tolgeeKeys = flattenLeafKeys(en, '', new Set<string>());
		const missing = refs.filter((ref) =>
			ref.semantics === 'tolgee' ? !tolgeeKeys.has(ref.key) : !resolvesToStringLeaf(en, ref.key)
		);
		const report = missing.map((ref) => `${ref.key} (${ref.file}:${ref.line})`).join('\n');
		expect(missing.length, `Keys referenced in code but missing from en.json:\n${report}`).toBe(0);
	});
});
