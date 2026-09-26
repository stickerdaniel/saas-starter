import { describe, expect, it } from 'vitest';
import svelteParser from 'svelte-eslint-parser';
import { parser as tsParser } from 'typescript-eslint';
import rule from './no-dynamic-import-rejection-handler.js';

function lint(code: string, filename = 'src/lib/example.ts'): Array<{ messageId: string }> {
	const reports: Array<{ messageId: string }> = [];
	const ast = filename.endsWith('.svelte')
		? svelteParser.parseForESLint(code, { parser: tsParser })
		: tsParser.parseForESLint(code, {});

	const context = {
		report: (opts: { messageId: string }) => reports.push(opts),
		getFilename: () => filename,
		filename
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
	}

	walk(ast.ast as unknown as Record<string, unknown>);
	return reports;
}

describe('no-dynamic-import-rejection-handler', () => {
	// --- Invalid: Vite moves these handlers inside its preload wrapper ---

	it('flags .then(onFulfilled, onRejected) on import()', () => {
		const reports = lint(`
			const load = () => import('./Editor.svelte').then((m) => m.default, onRejected);
		`);
		expect(reports).toHaveLength(1);
		expect(reports[0].messageId).toBe('rejectionHandlerOnImport');
	});

	it('flags .then(undefined, onRejected) on import()', () => {
		const reports = lint(`
			const load = () => import('./Editor.svelte').then(undefined, onRejected);
		`);
		expect(reports).toHaveLength(1);
	});

	it('flags the handler through a TypeScript cast on import()', () => {
		const reports = lint(`
			const load = () =>
				(import('./Editor.svelte') as Promise<EditorModule>).then((m) => m.default, onRejected);
		`);
		expect(reports).toHaveLength(1);
	});

	it('flags a rejection handler supplied by a spread array literal', () => {
		const reports = lint(`
			const a = () => import('./Editor.svelte').then(...[pick, onRejected]);
			const b = () => import('./Editor.svelte').then(pick, ...[onRejected]);
			const c = () => import('./Editor.svelte').then(...([pick, onRejected] as const));
		`);
		expect(reports).toHaveLength(3);
	});

	it('flags a spread of an unknown value that may supply the handler', () => {
		const reports = lint(`
			const handlers = [pick, onRejected] as const;
			const a = () => import('./Editor.svelte').then(...handlers);
			const b = () => import('./Editor.svelte').then(pick, ...rest);
		`);
		expect(reports).toHaveLength(2);
	});

	it('flags the #1023 loader in a Svelte component script', () => {
		const reports = lint(
			`<script lang="ts">
				const editor = import('./screenshot-editor/ScreenshotEditor.svelte').then(
					(module) => module.default,
					(error: unknown) => {
						handleScreenshotCaptureError(error);
						return null;
					}
				);
			</script>`,
			'src/lib/components/customer-support/customer-support.svelte'
		);
		expect(reports).toHaveLength(1);
	});

	it('flags the handler in Svelte markup', () => {
		const reports = lint(
			`{#await import('./Editor.svelte').then((m) => m.default, () => null) then Editor}
				<Editor />
			{/await}`,
			'src/routes/+page.svelte'
		);
		expect(reports).toHaveLength(1);
	});

	// --- Valid: the rejection still reaches the wrapper ---

	it('allows await import() inside try/catch', () => {
		const reports = lint(`
			async function load() {
				try {
					const module = await import('./Editor.svelte');
					return module.default;
				} catch (error) {
					onRejected(error);
					return null;
				}
			}
		`);
		expect(reports).toHaveLength(0);
	});

	it('allows .then(onFulfilled) without a rejection handler', () => {
		const reports = lint(`
			const load = () => import('./Editor.svelte').then((m) => m.default);
		`);
		expect(reports).toHaveLength(0);
	});

	it('allows undefined, null, and void 0 in the rejection position', () => {
		const reports = lint(`
			const a = () => import('./Editor.svelte').then(pick, undefined);
			const b = () => import('./Editor.svelte').then(pick, null);
			const c = () => import('./Editor.svelte').then(pick, void 0);
			const d = () => import('./Editor.svelte').then(pick, ...[undefined]);
		`);
		expect(reports).toHaveLength(0);
	});

	it('allows a spread array literal without a rejection handler', () => {
		const reports = lint(`
			const a = () => import('./Editor.svelte').then(...[pick]);
			const b = () => import('./Editor.svelte').then(...([pick] as const));
		`);
		expect(reports).toHaveLength(0);
	});

	it('allows optional ?.then and .then?.(), which stay outside the wrapper', () => {
		const reports = lint(`
			const a = () => import('./Editor.svelte')?.then(pick, onRejected);
			const b = () => import('./Editor.svelte').then?.(pick, onRejected);
		`);
		expect(reports).toHaveLength(0);
	});

	it('allows .catch() on import(), which stays outside the wrapper', () => {
		const reports = lint(`
			const load = () => import('./Editor.svelte').catch(onRejected);
		`);
		expect(reports).toHaveLength(0);
	});

	it('allows a handler chained after the first .then()', () => {
		const reports = lint(`
			const a = () => import('./Editor.svelte').then((m) => m.default).catch(onRejected);
			const b = () => import('./Editor.svelte').then((m) => m.default).then(undefined, onRejected);
		`);
		expect(reports).toHaveLength(0);
	});

	it('allows static imports and .then(ok, err) on other promises', () => {
		const reports = lint(`
			import Editor from './Editor.svelte';
			const result = fetch('/api').then((r) => r.json(), onRejected);
		`);
		expect(reports).toHaveLength(0);
	});
});
