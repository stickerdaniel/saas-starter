import { RuleTester } from 'eslint';
import { parser as tsParser } from 'typescript-eslint';
import { afterAll, describe, it } from 'vitest';
import rule from './confect-definition-imports.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.afterAll = afterAll;

const tester = new RuleTester({
	languageOptions: { parser: tsParser, ecmaVersion: 'latest', sourceType: 'module' }
});

const runtimeSpec = [{ messageId: 'runtimeSpec' }];
const confectRuntime = [{ messageId: 'confectRuntime' }];

tester.run('confect-definition-imports', rule, {
	valid: [
		`import type threads from './threads.spec';`,
		`import type { default as threads } from '../support/threads.spec.ts';`,
		`export type { default } from './threads.spec';`,
		`import type spec from '../_generated/spec';`,
		`import { FunctionSpec } from '@confect/core';`,
		`import { internal } from '../../convex/_generated/api';`,
		`import databaseSchema from '../_generated/schema';`,
		`import { inspect } from './inspector';`,
		`import { specification } from './specification';`,
		`import { respect } from './respect.ts';`
	],
	invalid: [
		{ code: `import threads from './threads.spec';`, errors: runtimeSpec },
		{ code: `import { type default as threads } from './threads.spec';`, errors: runtimeSpec },
		{ code: `import './threads.spec.ts';`, errors: runtimeSpec },
		{ code: `export { default } from './threads.spec';`, errors: runtimeSpec },
		{ code: `export * from '../support/threads.spec.js';`, errors: runtimeSpec },
		{ code: `const spec = await import('./threads.spec');`, errors: runtimeSpec },
		{ code: `import spec from '../_generated/spec';`, errors: runtimeSpec },
		{ code: `import refs from '../../_generated/refs';`, errors: runtimeSpec },
		{ code: `import { FunctionImpl } from '@confect/server';`, errors: confectRuntime },
		{ code: `import type { Handler } from '@confect/server';`, errors: confectRuntime },
		{ code: `import * as GroupImpl from '@confect/server/GroupImpl';`, errors: confectRuntime },
		{
			code: `import threads from '../_generated/registeredFunctions/support/threads';`,
			errors: confectRuntime
		},
		{
			code: `import type threads from '../_generated/registeredFunctions/support/threads';`,
			errors: confectRuntime
		}
	]
});
