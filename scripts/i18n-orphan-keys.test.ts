import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../src/i18n/en.json';

// Defined-but-unused guard for translation keys: every leaf key in en.json must
// be reachable from code. An orphan (a key nobody references) is dead weight
// that every locale has to keep in sync (locale-parity.test.ts forces de/es/fr
// to mirror en.json), and it lets a stale namespace masquerade as live copy.
//
// This is the mirror image of i18n-used-keys.test.ts: that test asserts every
// referenced key EXISTS in en.json (catches typos / renamed keys); this test
// asserts every key in en.json IS referenced (catches abandoned keys).
//
// The hard part is that translation keys are referenced both statically and
// DYNAMICALLY. i18n-used-keys.test.ts can safely skip dynamic refs (skipping a
// real ref only risks a false "missing" report, which never happens because the
// key exists). An orphan detector cannot: skipping a dynamic ref would falsely
// flag a live key as dead. So this detector resolves all five dynamic forms the
// codebase actually uses (see USED DERIVATION below) before declaring an orphan.

const SCAN_ROOT = path.resolve('src');
const EXCLUDED_DIRS = new Set([path.join(SCAN_ROOT, 'i18n')]);
const CONVEX_ROOT = path.join(SCAN_ROOT, 'lib', 'convex');

// ---------------------------------------------------------------------------
// Literal extraction — same regexes as i18n-used-keys.test.ts.
// ---------------------------------------------------------------------------

// <T keyName="..."> static attribute, plus keyName={'...'} / keyName={"..."}.
const KEYNAME_ATTR = /keyName=(?:"([^"\n]*)"|\{\s*'([^'\n]*)'\s*\}|\{\s*"([^"\n]*)"\s*\})/g;

// Tolgee translate store: $t('key') / $t("key").
const TOLGEE_T = /\$t\(\s*(?:'([^'\n]*)'|"([^"\n]*)")/g;

// Convex backend helper t(locale, 'key', params?) — the key is the 2nd arg.
// Only meaningful under src/lib/convex/ where the helper lives.
const CONVEX_T =
	/(?<![\w$.])t\(\s*(?:['"][a-z]{2}['"]|[\w.$]+(?:\([^()]*\))?)\s*,\s*(?:'([^'\n]*)'|"([^"\n]*)")/g;

// ---------------------------------------------------------------------------
// Dynamic-reference resolvers — the part i18n-used-keys.test.ts deliberately
// omits. Each resolves one of the dynamic forms this codebase actually uses.
// ---------------------------------------------------------------------------

// (b/d) Any dotted string literal anywhere: 'a.b.c' / "a.b" / `a.b`.
// This single rule covers every *Key config-property convention because those
// values are plain dotted literals: translationKey:/roleKey:/nameKey:/titleKey:
// (sidebar, nav, team, screenshot-color, search-route, table-column configs),
// the 'aria-label-key' kebab attr, the ERROR_CODE_MAP / DEFAULT_AUTH_ERROR_KEY
// values in auth-messages.ts, ternary branch literals (keyName={c ? 'a' : 'b'}),
// and Record lookup maps ($t(map[field])). A literal only counts when it
// resolves to a real leaf, so non-i18n dotted strings (import paths, oklch()
// values, css selectors) are ignored.
const DOTTED_LITERAL = /['"`]([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)+)['"`]/g;

// (c) Svelte attribute interpolation prefix: keyName="prefix.{x}".
// pricing-three.svelte iterates feature index keys via
// <T keyName="pricing.features.free.{key}" />. Capture the literal prefix and
// mark every leaf under it as used.
const INTERP_ATTR_PREFIX = /keyName="([a-zA-Z_$][\w$.]*?)\.\{/g;

// (c) Template-literal prefix: $t(`prefix.${x}`) / t(locale, `prefix.${x}`).
const TEMPLATE_PREFIX = /`([a-zA-Z_$][\w$.]*?)\.\$\{/g;

// (d) Object-property access chains: error_page.* is reached only through member
// access (translations.error_page.not_found_title) in ErrorDisplay.svelte, never
// as a quoted dotted string. Match identifier chains and accept any contiguous
// sub-window that resolves to a real multi-segment leaf. en.json leaf paths are
// specific enough that ordinary JS member access (page.status, etc.) does not
// collide — verified: this resolver matches exactly the 9 error_page.* leaves
// and nothing else.
const MEMBER_CHAIN = /\b([a-z_$][\w$]*(?:\.[a-z_$][\w$]*)+)\b/gi;
const ANY_QUOTED_DOTTED = /['"`]([\w.]+)['"`]/g;

// ---------------------------------------------------------------------------
// (e) Allowlist — keys reachable ONLY via fully-dynamic runtime refs that no
// static scan can see. Keep this minimal and documented; never add a key here
// just to silence the test.
//
// auth.messages.* error keys: getAuthErrorKey() (src/lib/utils/auth-messages.ts)
// translates Better Auth error CODES into auth.messages.* keys at runtime, then
// the value is rendered via <T keyName={formError}> / toast.error($t(formError)).
// The ERROR_CODE_MAP literals are caught by DOTTED_LITERAL above, but these five
// correspond to Better Auth failure conditions (signup gating, password-breach
// checks, rate limiting, cancelled flows) that the backend can surface without a
// matching map entry in source. They are runtime-reachable, not dead copy, so
// they are allowlisted rather than reported as prune candidates.
const ALLOWLIST: Record<string, string> = {
	'auth.messages.auth_cancelled':
		'Better Auth runtime error key (auth flow cancelled); surfaced via getAuthErrorKey/formError, no static ref',
	'auth.messages.password_compromised':
		'Better Auth runtime error key (have-i-been-pwned breach check); surfaced via getAuthErrorKey/formError, no static ref',
	'auth.messages.rate_limited':
		'Better Auth runtime error key (auth rate limit hit); surfaced via getAuthErrorKey/formError, no static ref',
	'auth.messages.signup_disabled':
		'Better Auth runtime error key (signup disabled); surfaced via getAuthErrorKey/formError, no static ref',
	'auth.messages.too_many_attempts':
		'Better Auth runtime error key (too many attempts); surfaced via getAuthErrorKey/formError, no static ref'
};

// ---------------------------------------------------------------------------
// File walk — sorted fs traversal, deterministic, skips generated dirs.
// ---------------------------------------------------------------------------

function isScannable(file: string): boolean {
	if (file.endsWith('.test.ts') || file.endsWith('.spec.ts')) return false;
	return file.endsWith('.svelte') || file.endsWith('.ts');
}

function walk(dir: string, out: string[] = []): string[] {
	const entries = fs
		.readdirSync(dir, { withFileTypes: true })
		.sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === '_generated' || EXCLUDED_DIRS.has(full)) continue;
			walk(full, out);
		} else if (entry.isFile() && isScannable(full)) {
			out.push(full);
		}
	}
	return out;
}

// Every dot-path that resolves to a string leaf in en.json.
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

// ---------------------------------------------------------------------------
// USED DERIVATION
// Combine, for every scanned src file:
//   (a) literal refs        — KEYNAME_ATTR + TOLGEE_T (+ CONVEX_T under convex)
//   (b) dotted literals      — config-property *Key values, ternary branches,
//                              lookup-map literals, auth error-code map values
//   (c) interpolation/template prefixes — mark all leaves under the prefix used
//   (d) member-access chains — error_page.* via translations.error_page.<leaf>
// then union the allowlist (e). Only keys that resolve to a real en.json leaf
// are ever added, so noise (import paths, css, etc.) cannot inflate the set.
// ---------------------------------------------------------------------------
function deriveUsedKeys(leaves: Set<string>): { used: Set<string>; literalCount: number } {
	const used = new Set<string>();
	const prefixes = new Set<string>();
	let literalCount = 0;

	const markIfLeaf = (key: string | undefined) => {
		if (!key || key.includes('{') || key.includes('}')) return;
		if (leaves.has(key)) used.add(key);
	};

	for (const file of walk(SCAN_ROOT)) {
		const content = fs.readFileSync(file, 'utf-8');

		// (a) literal references
		const literalPatterns: RegExp[] = [KEYNAME_ATTR, TOLGEE_T];
		if (file.startsWith(CONVEX_ROOT + path.sep)) literalPatterns.push(CONVEX_T);
		for (const pattern of literalPatterns) {
			for (const match of content.matchAll(pattern)) {
				const key = match.slice(1).find((g) => g !== undefined);
				if (key === undefined || key === '') continue;
				literalCount++;
				markIfLeaf(key);
			}
		}

		// (b/d-via-literal) any dotted string literal that resolves to a leaf
		for (const match of content.matchAll(DOTTED_LITERAL)) markIfLeaf(match[1]);

		// (c) interpolation + template prefixes
		for (const match of content.matchAll(INTERP_ATTR_PREFIX)) prefixes.add(match[1]);
		for (const match of content.matchAll(TEMPLATE_PREFIX)) prefixes.add(match[1]);

		// (d) member-access chains (object-property access, not quoted strings)
		const quotedDotted = new Set<string>();
		for (const match of content.matchAll(ANY_QUOTED_DOTTED)) {
			if (match[1].includes('.')) quotedDotted.add(match[1]);
		}
		for (const match of content.matchAll(MEMBER_CHAIN)) {
			const chain = match[1];
			if (quotedDotted.has(chain)) continue; // already handled as a literal
			const parts = chain.split('.');
			for (let i = 0; i < parts.length; i++) {
				for (let j = i + 2; j <= parts.length; j++) {
					const sub = parts.slice(i, j).join('.');
					if (leaves.has(sub)) used.add(sub);
				}
			}
		}
	}

	// (c) expand prefixes: every leaf at-or-under a captured prefix is used.
	for (const leaf of leaves) {
		for (const prefix of prefixes) {
			if (leaf === prefix || leaf.startsWith(prefix + '.')) {
				used.add(leaf);
				break;
			}
		}
	}

	// (e) allowlist — runtime-only reachable keys.
	for (const key of Object.keys(ALLOWLIST)) {
		if (leaves.has(key)) used.add(key);
	}

	return { used, literalCount };
}

describe('i18n orphan keys', () => {
	const leaves = flattenLeafKeys(en, '', new Set<string>());
	const { used, literalCount } = deriveUsedKeys(leaves);

	it('en.json has leaf keys', () => {
		expect(leaves.size).toBeGreaterThan(0);
	});

	it('finds literal key references in src', () => {
		// Sanity floor: if the walk or the regexes break, fail here loudly rather
		// than letting the orphan assertion pass vacuously by flagging everything.
		expect(literalCount).toBeGreaterThan(100);
	});

	it('every allowlisted key still exists in en.json', () => {
		// A stale allowlist entry (key deleted from en.json) should fail so the
		// allowlist never silently rots.
		const stale = Object.keys(ALLOWLIST).filter((key) => !leaves.has(key));
		expect(
			stale,
			`Allowlisted keys missing from en.json (remove them):\n${stale.join('\n')}`
		).toEqual([]);
	});

	it('has no orphan keys (defined in en.json but never referenced)', () => {
		const orphans = [...leaves].filter((key) => !used.has(key)).sort();
		const report = orphans.join('\n');
		expect(
			orphans.length,
			`Translation keys defined in en.json but never referenced in src ` +
				`(literal, dotted-literal, interpolation/template prefix, member-access, ` +
				`or allowlist). Either remove them from all locale files, reference them, ` +
				`or add a documented ALLOWLIST entry if reachable only at runtime:\n${report}`
		).toBe(0);
	});
});
