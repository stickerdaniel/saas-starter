// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import safeSvelteParser from '../eslint/parsers/safe-svelte-parser.js';
import {
	BASELINE_PATH,
	PROBE_PATH,
	PROBE_SOURCE,
	WATCHED_SOURCE,
	comparisonBase,
	coverageProblems,
	createScanner,
	engineIdentity,
	evaluate,
	findingDigest,
	findingSubject,
	parseBaseline,
	parseRenames,
	policyRuleIds,
	resolveProtectedBase,
	toBaseline,
	type Finding,
	type Snapshot
} from './shadcn-baseline';

const root = path.resolve(import.meta.dirname, '..');
const identity = { policy: 'policy-a', config: 'config-a', engine: 'engine-a' };
const rules = policyRuleIds();
const button =
	'"rounded-full" is not allowed on <Button>: <Button> owns its shape. Use a variant: default, outline.';
const arbitrary = '"w-[550px]" hardcodes an off-token value. Use "w-137.5" instead.';

function finding(file: string, rule: string, message: string, line = 1): Finding {
	return { file, rule, digest: findingDigest(message), line, column: 1, message };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
	return {
		identity,
		rules,
		included: ['src/a.svelte', 'src/b.svelte'],
		ignored: ['src/lib/convex/_generated/api.js'],
		findings: [
			finding('src/a.svelte', 'shadcn/no-restyle', button, 3),
			finding('src/a.svelte', 'shadcn/no-arbitrary-values', arbitrary, 4)
		],
		...overrides
	};
}

function verdict(
	current: Snapshot,
	base = snapshot(),
	head = toBaseline(current),
	renames = new Map()
) {
	return evaluate({
		current,
		head,
		protectedBaseline: toBaseline(base),
		protectedLabel: 'base',
		renames
	});
}

describe('finding identity', () => {
	it('keeps the offending class and component and drops the advice after them', () => {
		expect(findingSubject(button)).toBe('"rounded-full" is not allowed on <Button>');
		expect(findingSubject('"hover:bg-zinc-950/5" uses the raw Tailwind palette. Nearest: x.')).toBe(
			'"hover:bg-zinc-950/5" uses the raw Tailwind palette'
		);
		expect(findingDigest(button)).toBe(
			findingDigest('"rounded-full" is not allowed on <Button>: add a variant in a\\b.svelte.')
		);
		expect(findingDigest(button)).not.toBe(
			findingDigest('"rounded-md" is not allowed on <Button>: <Button> owns its shape.')
		);
	});
});

describe('baseline verdict', () => {
	it('accepts the recorded tree and harmless line shifts', () => {
		expect(verdict(snapshot())).toEqual({ blocking: [], stale: [], notes: [] });
		const shifted = snapshot({
			findings: snapshot().findings.map((item) => ({ ...item, line: item.line + 40 }))
		});
		expect(verdict(shifted)).toEqual({ blocking: [], stale: [], notes: [] });
	});

	it('rejects a different finding that keeps every rule count', () => {
		const substituted = snapshot({
			findings: [
				finding('src/a.svelte', 'shadcn/no-restyle', '"h-12" is not allowed on <Button>: no.', 3),
				finding('src/a.svelte', 'shadcn/no-arbitrary-values', arbitrary, 4)
			]
		});
		const { blocking } = verdict(substituted);
		expect(blocking).toHaveLength(1);
		expect(blocking[0]).toContain('New shadcn/lint findings');
		expect(blocking[0]).toContain('"h-12" is not allowed on <Button>');
		expect(blocking[0]).not.toContain('rounded-full');
	});

	it('does not let a rewritten committed baseline accept a new finding', () => {
		const added = snapshot({
			findings: [...snapshot().findings, finding('src/b.svelte', 'shadcn/no-restyle', button, 9)]
		});
		const result = verdict(added, snapshot(), toBaseline(added));
		expect(result.stale).toEqual([]);
		expect(result.blocking.join('\n')).toContain('src/b.svelte:9:1 shadcn/no-restyle');
	});

	it('treats fixed findings as stale until the baseline is regenerated', () => {
		const fixed = snapshot({ findings: snapshot().findings.slice(1) });
		const stale = verdict(fixed, snapshot(), toBaseline(snapshot()));
		expect(stale.blocking).toEqual([]);
		expect(stale.stale.join('\n')).toContain('Recorded findings differ for:\n    src/a.svelte');
		expect(verdict(fixed)).toEqual({ blocking: [], stale: [], notes: [] });
	});

	it('follows a detected rename and otherwise treats moved findings as new', () => {
		const renamed = snapshot({
			included: ['src/renamed.svelte', 'src/b.svelte'],
			findings: snapshot().findings.map((item) => ({ ...item, file: 'src/renamed.svelte' }))
		});
		expect(
			verdict(renamed, snapshot(), undefined, new Map([['src/renamed.svelte', 'src/a.svelte']]))
		).toEqual({ blocking: [], stale: [], notes: [] });
		expect(verdict(renamed).blocking.join('\n')).toContain('src/renamed.svelte:3:1');
	});

	it('rejects a covered file that becomes ignored', () => {
		const ignoredFile = snapshot({
			included: ['src/b.svelte'],
			ignored: ['src/a.svelte', 'src/lib/convex/_generated/api.js'],
			findings: []
		});
		const { blocking } = verdict(ignoredFile);
		expect(blocking).toHaveLength(1);
		expect(blocking[0]).toContain('were not ignored on base');
		expect(blocking[0]).toContain('src/a.svelte');
	});

	it.each(['policy', 'config'] as const)(
		'lets a %s change land with its regenerated baseline',
		(field) => {
			// The policy diff and the shrunken baseline are reviewed together in the same PR.
			const changed = snapshot({
				identity: { ...identity, [field]: 'changed' },
				findings: snapshot().findings.slice(1)
			});
			const unregenerated = verdict(changed, snapshot(), toBaseline(snapshot()));
			expect(unregenerated.blocking).toEqual([]);
			expect(unregenerated.stale.join('\n')).toContain(`identity.${field}`);
			const regenerated = verdict(changed);
			expect(regenerated.blocking).toEqual([]);
			expect(regenerated.stale).toEqual([]);
		}
	);

	it('still rejects a new finding that a policy change introduces', () => {
		const tightened = snapshot({
			identity: { ...identity, policy: 'changed' },
			findings: [...snapshot().findings, finding('src/b.svelte', 'shadcn/no-restyle', button, 2)]
		});
		const { blocking } = verdict(tightened);
		expect(blocking).toHaveLength(1);
		expect(blocking[0]).toContain('src/b.svelte:2:1 shadcn/no-restyle');
	});

	it('rejects a policy change that removes a rule', () => {
		const fewer = snapshot({
			identity: { ...identity, policy: 'changed' },
			rules: rules.filter((rule) => rule !== 'shadcn/no-arbitrary-values'),
			findings: snapshot().findings.slice(0, 1)
		});
		const { blocking } = verdict(fewer);
		expect(blocking).toHaveLength(1);
		expect(blocking[0]).toContain('The policy rule set changed');
	});

	it('reports a lint engine change without failing, even in the committed file', () => {
		const updated = snapshot({ identity: { ...identity, engine: 'engine-b' } });
		const result = verdict(updated, snapshot(), toBaseline(snapshot()));
		expect(result.blocking).toEqual([]);
		expect(result.stale).toEqual([]);
		expect(result.notes.join('\n')).toContain('lint engine');
	});

	it('passes a new clean file and a clean rename without regenerating', () => {
		const head = toBaseline(snapshot());
		const grown = snapshot({ included: ['src/a.svelte', 'src/b.svelte', 'src/new.svelte'] });
		expect(verdict(grown, snapshot(), head)).toEqual({ blocking: [], stale: [], notes: [] });
		const renamed = snapshot({ included: ['src/a.svelte', 'src/renamed-b.svelte'] });
		expect(verdict(renamed, snapshot(), head)).toEqual({ blocking: [], stale: [], notes: [] });
		expect(Object.keys(head.files)).toEqual(['src/a.svelte']);
	});

	it('treats a deleted file with findings and a changed ignored list as stale', () => {
		const deleted = snapshot({ included: ['src/b.svelte'], ignored: [], findings: [] });
		const { blocking, stale } = verdict(deleted, snapshot(), toBaseline(snapshot()));
		expect(blocking).toEqual([]);
		expect(stale.join('\n')).toContain('Recorded findings differ for:\n    src/a.svelte');
		expect(stale.join('\n')).toContain('The ignored source set differs:');
	});
});

describe('protected base', () => {
	const clean = { blocking: [], stale: [], notes: [] };
	const renamed = snapshot({
		included: ['src/renamed.svelte', 'src/b.svelte'],
		findings: snapshot().findings.map((item) => ({ ...item, file: 'src/renamed.svelte' }))
	});
	const readRenames = () => new Map([['src/renamed.svelte', 'src/a.svelte']]);

	function check(
		current: Snapshot,
		base: Parameters<typeof comparisonBase>[0],
		head = toBaseline(current)
	) {
		return evaluate({ current, head, ...comparisonBase(base, head, readRenames) });
	}

	it('keeps current paths when the bootstrap baseline is the allowance', () => {
		// The head baseline is indexed by current paths, so a base-to-head rename must not apply.
		const bootstrap = { commit: 'c'.repeat(40), label: 'base c', bootstrap: 'no baseline' };
		expect(check(renamed, bootstrap)).toEqual(clean);
	});

	it('follows renames when the allowance is read from the protected base', () => {
		const base = { commit: 'c'.repeat(40), label: 'base c', baseline: toBaseline(snapshot()) };
		expect(check(renamed, base)).toEqual(clean);
	});

	it('bootstraps from the committed baseline on an all-zero base', () => {
		// GitHub sends 40 zeros as `before` on the push that creates a branch or repository.
		const base = resolveProtectedBase(undefined, {
			GITHUB_ACTIONS: 'true',
			SHADCN_BASELINE_BASE: '0'.repeat(40)
		});
		expect(base.baseline).toBeUndefined();
		expect(base.commit).toBeUndefined();
		expect(base.bootstrap).toContain('needs review as a whole');
		const committed = toBaseline(snapshot());
		expect(check(snapshot(), base, committed)).toEqual(clean);
		const added = snapshot({
			findings: [...snapshot().findings, finding('src/b.svelte', 'shadcn/no-restyle', button, 7)]
		});
		expect(check(added, base, committed).blocking.join('\n')).toContain(
			'src/b.svelte:7:1 shadcn/no-restyle'
		);
	});

	it('still rejects a requested base that is not a commit', () => {
		expect(() => resolveProtectedBase(undefined, { SHADCN_BASELINE_BASE: 'f'.repeat(40) })).toThrow(
			'is not a commit'
		);
	});
});

describe('source extensions', () => {
	const extensions = ['svelte', 'ts', 'js', 'mts', 'cts', 'mjs', 'cjs', 'tsx', 'jsx'];

	it('covers every watched script extension with all policy rules', async () => {
		const scanner = createScanner(root);
		for (const extension of extensions) {
			expect(WATCHED_SOURCE.test(`src/lib/probe.${extension}`), extension).toBe(true);
			if (extension === 'svelte') continue; // Parser identity is covered separately above.
			const file = `src/lib/probe.${extension}`;
			const config = await scanner.calculateConfigForFile(path.join(root, file));
			expect(coverageProblems(file, config), extension).toEqual([]);
		}
		expect(WATCHED_SOURCE.test('src/app.css')).toBe(false);
	});

	it('reports a finding in an .mjs module', async () => {
		const scanner = createScanner(root);
		const [result] = await scanner.lintText(
			"import { cn } from '$lib/utils';\nexport const classes = cn('bg-red-500');\n",
			{ filePath: path.join(root, 'src/lib/probe.mjs') }
		);
		expect(result.fatalErrorCount).toBe(0);
		expect(result.messages.map((message) => message.ruleId)).toContain('shadcn/no-raw-colors');
	});
});

describe('scan configuration', () => {
	it('requires every policy rule with its policy options and the safe Svelte parser', async () => {
		const scanner = createScanner(root);
		const calculated = await scanner.calculateConfigForFile(path.join(root, PROBE_PATH));
		// ESLint imports the config natively while Vitest imports this test through Vite, so
		// the parser object differs by module instance here; the gate runs both in one Bun
		// process. The parse path itself is proven by the sanitized fatal message below.
		const config = {
			...calculated,
			languageOptions: { ...calculated.languageOptions, parser: safeSvelteParser }
		};
		expect(coverageProblems(PROBE_PATH, config)).toEqual([]);
		expect(config.rules['shadcn/no-restyle'][0]).toBe(2);

		const off = { ...config, rules: { ...config.rules, 'shadcn/no-restyle': [0] } };
		const widened = {
			...config,
			rules: { ...config.rules, 'shadcn/no-restyle': [2, { allow: ['layout', 'color'] }] }
		};
		const reparsed = { ...config, languageOptions: { ...config.languageOptions, parser: {} } };
		expect(coverageProblems(PROBE_PATH, off)).toEqual([
			`${PROBE_PATH}: shadcn/no-restyle is not active with the policy options.`
		]);
		expect(coverageProblems(PROBE_PATH, widened)).toHaveLength(1);
		expect(coverageProblems(PROBE_PATH, reparsed)).toEqual([
			`${PROBE_PATH}: Svelte files must be parsed by eslint/parsers/safe-svelte-parser.js.`
		]);
		expect(coverageProblems('src/x.mjs', undefined)).toHaveLength(1);
	});

	it('ignores exactly what the application config ignores', async () => {
		const scanner = createScanner(root);
		const application = new ESLint({ cwd: root });
		for (const file of [
			PROBE_PATH,
			'src/lib/utils.ts',
			'src/env.d.ts',
			'src/lib/convex/_generated/api.js',
			'src/lib/convex/convex-env.d.ts',
			'scratch/probe.svelte'
		]) {
			const absolute = path.join(root, file);
			expect(await scanner.isPathIgnored(absolute), file).toBe(
				await application.isPathIgnored(absolute)
			);
		}
	});

	it('parses Svelte through the safe parser', async () => {
		const scanner = createScanner(root);
		const [result] = await scanner.lintText(`<div>{${String.fromCharCode(0x1b)}}</div>`, {
			filePath: path.join(root, PROBE_PATH)
		});
		const fatal = result.messages.filter((message) => message.fatal);
		expect(fatal).toHaveLength(1);
		expect(fatal[0].message).toContain('U+001B');
	});

	it('triggers every policy rule through the probe, even under an inline disable', async () => {
		const scanner = createScanner(root);
		// A script comment is a native directive; it would silence the template below it.
		const disabled = PROBE_SOURCE.replace(
			'<script lang="ts">',
			'<script lang="ts">/* eslint-disable */'
		);
		expect(disabled).not.toBe(PROBE_SOURCE);
		const [result] = await scanner.lintText(disabled, { filePath: path.join(root, PROBE_PATH) });
		expect(result.fatalErrorCount).toBe(0);
		expect(new Set(result.messages.map((message) => message.ruleId))).toEqual(new Set(rules));
	}, 60_000);
});

describe('baseline inputs', () => {
	const lock = readFileSync(path.join(root, 'bun.lock'), 'utf8');

	it('binds the lint engine closure and ignores unrelated packages', () => {
		const base = engineIdentity(lock);
		// cn is reached only through @shadcn/lint; zod is outside the lint engine.
		const cn = lock.match(/"cn": \["cn@[^"]+"/)![0];
		expect(engineIdentity(lock.replace(cn, '"cn": ["cn@0.0.0"'))).not.toBe(base);
		const zod = lock.match(/"zod": \["zod@[^"]+"/)![0];
		expect(engineIdentity(lock.replace(zod, '"zod": ["zod@0.0.0"'))).toBe(base);
	});

	it('records the committed baseline for every policy rule', () => {
		const baseline = parseBaseline(readFileSync(path.join(root, BASELINE_PATH), 'utf8'), 'file');
		expect(baseline.rules).toEqual(rules);
		expect(rules).toHaveLength(6);
	});

	it('maps current paths to their base paths for renames only', () => {
		const output = [
			'M',
			'src/a.ts',
			'R087',
			'src/old.svelte',
			'src/new.svelte',
			'D',
			'src/x.ts',
			''
		];
		expect(parseRenames(output.join('\0'))).toEqual(
			new Map([['src/new.svelte', 'src/old.svelte']])
		);
	});
});
