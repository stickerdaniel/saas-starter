import { describe, expect, it } from 'vitest';
import parser from 'svelte-eslint-parser';
import rule from './no-frozen-auth-page-data.js';

const MARKETING_FILE = '/repo/src/lib/components/marketing/marketing-header.svelte';
const MARKETING_ROUTE_FILE = '/repo/src/routes/[[lang]]/(marketing)/+page.svelte';
const SUPPORT_FILE = '/repo/src/lib/components/customer-support/customer-support.svelte';
const BLOCKS_FILE = '/repo/src/blocks/pricing/pricing-three.svelte';
const APP_FILE = '/repo/src/routes/[[lang]]/app/+page.svelte';

function lint(template: string, filename: string): Array<{ messageId: string; data?: unknown }> {
	const reports: Array<{ messageId: string; data?: unknown }> = [];
	const ast = parser.parseForESLint(template, {});

	const context = {
		report: (opts: { messageId: string; data?: unknown }) => reports.push(opts),
		getFilename: () => filename,
		filename
	};

	const listeners = rule.create(context);

	function walk(node: Record<string, unknown>) {
		if (!node || typeof node !== 'object') return;
		const type = node.type as string;
		if (type && typeof listeners[type] === 'function') {
			(listeners[type] as (n: unknown) => void)(node);
		}
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

describe('no-frozen-auth-page-data', () => {
	it('flags page.data.viewer in a marketing component', () => {
		const reports = lint('<script>const v = page.data.viewer;</script>', MARKETING_FILE);
		expect(reports).toHaveLength(1);
		expect(reports[0].messageId).toBe('frozenAuthRead');
		expect((reports[0].data as { field: string }).field).toBe('viewer');
	});

	it('flags page.data.autumnState in a (marketing) route file', () => {
		const reports = lint(
			'<script>const p = page.data.autumnState?.products;</script>',
			MARKETING_ROUTE_FILE
		);
		expect(reports).toHaveLength(1);
		expect((reports[0].data as { field: string }).field).toBe('autumnState');
	});

	it('flags page.data.autumnState in a src/blocks marketing block', () => {
		const reports = lint(
			'<script>const c = page.data.autumnState?.customer;</script>',
			BLOCKS_FILE
		);
		expect(reports).toHaveLength(1);
		expect((reports[0].data as { field: string }).field).toBe('autumnState');
	});

	it('flags page.data.authState in the customer-support widget', () => {
		const reports = lint(
			'<script>const a = page.data.authState.isAuthenticated;</script>',
			SUPPORT_FILE
		);
		expect(reports).toHaveLength(1);
		expect((reports[0].data as { field: string }).field).toBe('authState');
	});

	it('flags the bare data prop (data.viewer) in a marketing component', () => {
		const reports = lint(
			'<script>let { data } = $props(); const v = data.viewer;</script>',
			MARKETING_FILE
		);
		expect(reports).toHaveLength(1);
		expect((reports[0].data as { field: string }).field).toBe('viewer');
	});

	it('flags the $page store form ($page.data.viewer)', () => {
		const reports = lint('<span>{$page.data.viewer}</span>', MARKETING_FILE);
		expect(reports).toHaveLength(1);
	});

	it('flags computed access (page.data["autumnState"])', () => {
		const reports = lint(
			'<script>const p = page.data["autumnState"];</script>',
			MARKETING_ROUTE_FILE
		);
		expect(reports).toHaveLength(1);
	});

	it('allows page.data.lang (not an auth/billing field)', () => {
		const reports = lint('<script>const l = page.data.lang;</script>', MARKETING_FILE);
		expect(reports).toHaveLength(0);
	});

	it('allows authClient.useSession() usage', () => {
		const reports = lint(
			'<script>const id = authClient.useSession().data?.user?.id;</script>',
			SUPPORT_FILE
		);
		expect(reports).toHaveLength(0);
	});

	it('ignores page.data.viewer inside an /app route file', () => {
		const reports = lint('<script>const v = page.data.viewer;</script>', APP_FILE);
		expect(reports).toHaveLength(0);
	});

	it('does not attach listeners outside the marketing surface', () => {
		const context = {
			report: () => {},
			getFilename: () => APP_FILE,
			filename: APP_FILE
		};
		expect(Object.keys(rule.create(context))).toHaveLength(0);
	});
});
