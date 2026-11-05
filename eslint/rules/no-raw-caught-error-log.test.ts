import { RuleTester } from 'eslint';
import { parser as tsParser } from 'typescript-eslint';
import { afterAll, describe, it } from 'vitest';
import rule from './no-raw-caught-error-log.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.afterAll = afterAll;

const tester = new RuleTester({
	languageOptions: { parser: tsParser, ecmaVersion: 'latest', sourceType: 'module' }
});

const flagged = [{ messageId: 'rawCaughtError' }];

tester.run('no-raw-caught-error-log', rule, {
	valid: [
		// The safe reporter is the intended path.
		`try { await load(); } catch (error) { reportRecoveredFailure('[load] failed', error); }`,
		// Fixed text carries no caught value.
		`try { await load(); } catch { console.error('[load] failed'); }`,
		`try { await load(); } catch (error) { console.error('[load] failed'); throw error; }`,
		// A parameter named like an error, but not a rejection reason.
		`items.forEach((error) => console.error(error));`,
		`promise.then((error) => console.error(error));`,
		`promise.finally(() => console.error('done'));`,
		// Shadowing: the logged binding is no longer the caught one.
		`try { await load(); } catch (error) { const log = (error: string) => console.error(error); log('x'); }`,
		// A local console is someone else's sink.
		`const console = logger; try { await load(); } catch (error) { console.error(error); }`,
		// A mutable alias is outside the rule's reach.
		`try { await load(); } catch (error) { let copy = error; console.error(copy); }`
	],
	invalid: [
		{
			code: `try { await load(); } catch (error) { console.error('[load] failed:', error); }`,
			errors: flagged
		},
		{ code: `promise.catch((e) => console.error(e));`, errors: flagged },
		{ code: `promise.catch(function (e) { console.warn('x', e); });`, errors: flagged },
		{ code: `promise.then(undefined, (e) => console.error(e));`, errors: flagged },
		{ code: `promise.then(onFulfilled, (e) => { console.log(e); });`, errors: flagged },
		{ code: `promise.catch(({ message }) => console.error(message));`, errors: flagged },
		{ code: `try { run(); } catch (error) { console.error(error.message); }`, errors: flagged },
		{ code: `try { run(); } catch (error) { console.error({ error }); }`, errors: flagged },
		{ code: `try { run(); } catch (error) { console.error({ cause: error }); }`, errors: flagged },
		{ code: `try { run(); } catch (error) { console.error([error]); }`, errors: flagged },
		{
			code: 'try { run(); } catch (error) { console.error(`failed: ${error}`); }',
			errors: flagged
		},
		{
			code: `try { run(); } catch (error) { console.error(error as Error); }`,
			errors: flagged
		},
		{
			code: `try { run(); } catch (error) { const failure = error; console.error(failure); }`,
			errors: flagged
		},
		{ code: `try { run(); } catch ({ message }) { console.info(message); }`, errors: flagged },
		{
			code: `try { run(); } catch (error) { console['error'](error); }`,
			errors: flagged
		},
		{
			code: `try { run(); } catch (error) { setTimeout(() => console.error(error)); }`,
			errors: flagged
		}
	]
});
