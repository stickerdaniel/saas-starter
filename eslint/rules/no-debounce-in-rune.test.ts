import { describe, expect, it } from 'vitest';
import parser from 'svelte-eslint-parser';
import rule from './no-debounce-in-rune.js';

/**
 * Walk the parsed AST calling enter (`Type`) and exit (`Type:exit`) listeners,
 * so the rule's runeStack push/pop works exactly as it does under real ESLint.
 */
function lint(code: string): Array<{ messageId: string }> {
	const reports: Array<{ messageId: string }> = [];
	const ast = parser.parseForESLint(code, {});

	const context = {
		report: (opts: { messageId: string }) => reports.push(opts),
		getFilename: () => 'test.svelte',
		filename: 'test.svelte'
	};

	const listeners = rule.create(context) as Record<string, (n: unknown) => void>;

	function walk(node: Record<string, unknown>) {
		if (!node || typeof node !== 'object') return;
		const type = node.type as string;
		if (type && typeof listeners[type] === 'function') listeners[type](node);
		for (const key of Object.keys(node)) {
			if (key === 'parent') continue;
			const val = node[key];
			if (Array.isArray(val)) val.forEach((v) => walk(v as Record<string, unknown>));
			else if (val && typeof val === 'object' && (val as Record<string, unknown>).type)
				walk(val as Record<string, unknown>);
		}
		if (type && typeof listeners[`${type}:exit`] === 'function') listeners[`${type}:exit`](node);
	}

	walk(ast.ast as unknown as Record<string, unknown>);
	return reports;
}

const wrap = (script: string) => `<script>\n${script}\n</script>`;

describe('no-debounce-in-rune', () => {
	// --- Invalid: the #402 regression shapes ---

	it('flags a useDebounce() call inside $effect', () => {
		const reports = lint(
			wrap(`
				import { useDebounce } from 'runed';
				const forceLoad = useDebounce(() => {}, 3000);
				$effect(() => {
					forceLoad().catch(() => {});
					return () => forceLoad.cancel();
				});
			`)
		);
		// both the call and the cleanup cancel must be flagged
		expect(reports).toHaveLength(2);
		expect(reports.every((r) => r.messageId === 'debounceInRune')).toBe(true);
	});

	it('flags .cancel() in an $effect cleanup', () => {
		const reports = lint(
			wrap(`
				import { useDebounce } from 'runed';
				const schedule = useDebounce(() => {}, 1000);
				$effect(() => {
					return () => schedule.cancel();
				});
			`)
		);
		expect(reports).toHaveLength(1);
		expect(reports[0].messageId).toBe('debounceInRune');
	});

	it('flags a useDebounce() call inside $derived.by', () => {
		const reports = lint(
			wrap(`
				import { useDebounce } from 'runed';
				const f = useDebounce(() => 1, 200);
				const x = $derived.by(() => {
					f();
					return 1;
				});
			`)
		);
		expect(reports).toHaveLength(1);
		expect(reports[0].messageId).toBe('debounceInRune');
	});

	// --- Valid: must NOT be flagged ---

	it('allows the Debounced class read inside a rune', () => {
		const reports = lint(
			wrap(`
				import { Debounced } from 'runed';
				const d = new Debounced(() => value, 300);
				const x = $derived(d.current);
			`)
		);
		expect(reports).toHaveLength(0);
	});

	it('allows a useDebounce() result called from an event handler', () => {
		const reports = lint(
			`<script>
				import { useDebounce } from 'runed';
				const f = useDebounce(() => {}, 300);
			</script>
			<button onclick={() => f()}>go</button>`
		);
		expect(reports).toHaveLength(0);
	});

	it('allows setTimeout inside an $effect', () => {
		const reports = lint(
			wrap(`
				$effect(() => {
					const t = setTimeout(() => {}, 300);
					return () => clearTimeout(t);
				});
			`)
		);
		expect(reports).toHaveLength(0);
	});

	it('allows a useDebounce() result called outside any rune', () => {
		const reports = lint(
			wrap(`
				import { useDebounce } from 'runed';
				const f = useDebounce(() => {}, 300);
				function handle() { f(); }
			`)
		);
		expect(reports).toHaveLength(0);
	});
});
