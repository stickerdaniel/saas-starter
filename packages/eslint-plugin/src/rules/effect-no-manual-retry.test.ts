import { describe, expect, it } from 'vitest';
import { lintRule } from './effect-rule-harness';
import rule from './effect-no-manual-retry.js';

const lint = (code: string, file?: string) =>
	lintRule(rule, code, { file, options: { files: ['src/lib/effect/**'] } });

describe('effect-no-manual-retry', () => {
	it.each([
		'for (let attempt = 0; attempt < 3; attempt++) {\n\ttry { return await send(); } catch { await sleep(300); }\n}',
		'while (true) {\n\ttry { return await send(); } catch {\n\t\tawait new Promise((resolve) => setTimeout(resolve, 300));\n\t}\n}',
		'do {\n\tresult = await send().catch(() => undefined);\n\tawait Bun.sleep(300);\n} while (!result);',
		'for (const delay of delays) {\n\ttry { return await send(); } catch {}\n\tawait wait(delay);\n}'
	])('reports a loop that catches and waits: %s', (code) => {
		expect(lint(code)).toEqual([{ messageId: 'manualRetry', line: 1 }]);
	});

	it('reports only the innermost retry loop', () => {
		const code =
			'for (const job of jobs) {\n\twhile (true) {\n\t\ttry { await job(); break; } catch { await sleep(100); }\n\t}\n}';
		expect(lint(code)).toEqual([{ messageId: 'manualRetry', line: 2 }]);
	});

	it.each([
		'for (const item of items) {\n\ttry { await send(item); } catch { failed.push(item); }\n}',
		'while (polling) {\n\tawait sleep(1000);\n\trefresh();\n}',
		'try { await send(); } catch { await sleep(300); }'
	])('allows a loop with only one of the two, and a single attempt: %s', (code) => {
		expect(lint(code)).toEqual([]);
	});

	it('checks only the configured files', () => {
		const code = 'while (true) {\n\ttry { return await send(); } catch { await sleep(300); }\n}';
		expect(lint(code, 'scripts/deploy.ts')).toEqual([]);
	});
});
