import { describe, expect, it } from 'vitest';
import { parser } from 'typescript-eslint';
import rule from './no-module-state-singleton.js';

function lint(code: string): Array<{ messageId: string }> {
	const reports: Array<{ messageId: string }> = [];
	const ast = parser.parseForESLint(code, {});

	const context = {
		report: (opts: { messageId: string }) => reports.push(opts),
		getFilename: () => 'test.svelte.ts',
		filename: 'test.svelte.ts'
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

describe('no-module-state-singleton', () => {
	it('flags a top-level exported class instance', () => {
		const reports = lint(`export const manager = new ChatManager();`);
		expect(reports).toHaveLength(1);
		expect(reports[0].messageId).toBe('moduleStateSingleton');
	});

	it('flags an exported PersistedState instance', () => {
		const reports = lint(`
			export const supportUserId = new PersistedState<string | null>('supportUserId', null);
		`);
		expect(reports).toHaveLength(1);
	});

	it('allows runed Context definitions', () => {
		const reports = lint(`
			export const chatContext = new Context<ChatManager>('chat');
		`);
		expect(reports).toHaveLength(0);
	});

	it('flags every offending declarator in a multi-declarator export', () => {
		const reports = lint(`export const a = new A(), ctx = new Context('x'), b = new B();`);
		expect(reports).toHaveLength(2);
	});

	it('allows non-exported module-scope instances', () => {
		const reports = lint(`const internal = new Helper();`);
		expect(reports).toHaveLength(0);
	});

	it('allows exported factory-function results', () => {
		const reports = lint(`export const table = createConvexCursorTable(options);`);
		expect(reports).toHaveLength(0);
	});

	it('allows exported classes, functions and plain values', () => {
		expect(lint(`export class ChatManager {}`)).toHaveLength(0);
		expect(lint(`export function makeManager() { return new ChatManager(); }`)).toHaveLength(0);
		expect(lint(`export const LIMIT = 100;`)).toHaveLength(0);
	});

	it('flags export let and export var the same as export const', () => {
		expect(lint(`export let manager = new ChatManager();`)).toHaveLength(1);
		expect(lint(`export var manager = new ChatManager();`)).toHaveLength(1);
	});
});
