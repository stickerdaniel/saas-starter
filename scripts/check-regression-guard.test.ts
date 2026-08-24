import { describe, expect, it } from 'vitest';
import { checkRegressionGuard } from './check-regression-guard';

const FIX = 'fix(auth): Correct callback';
const AUTHOR = 'stickerdaniel';

function verdict(body: string, title = FIX, author = AUTHOR) {
	return checkRegressionGuard({ title, body, author });
}

describe('checkRegressionGuard', () => {
	it.each([
		'Regression guard: added scripts/auth-callback.test.ts',
		'Regression guard: covered by eslint/no-unsafe-callback',
		'Regression guard: not warranted, the callback type excludes the old value'
	])('accepts a plain verdict as the first substantive line: %s', (body) => {
		expect(verdict(body)).toMatchObject({ required: true, valid: true });
	});

	it('allows one issue-closing line before the verdict', () => {
		expect(
			verdict('Closes #832\n\nRegression guard: added scripts/source-safety.test.ts')
		).toMatchObject({ valid: true });
	});

	it.each([
		'',
		'Problem first.\n\nRegression guard: added guard.test.ts',
		'```text\nRegression guard: added guard.test.ts\n```',
		'<!--\nRegression guard: added guard.test.ts\n-->',
		'<details>\nRegression guard: added guard.test.ts\n</details>',
		'Closes #832\n\nProblem first.\nRegression guard: added guard.test.ts'
	])('rejects a missing or displaced verdict: %s', (body) => {
		expect(verdict(body)).toMatchObject({ required: true, valid: false });
	});

	it.each([
		'Regression guard: added `<name>`',
		'Regression guard: added name',
		'Regression guard: not warranted, one-line reason',
		'Regression guard: added TODO',
		'Regression guard: not warranted, TBD',
		'Regression guard: added ＴＯＤＯ',
		'Regression guard: added TÓDO',
		`Regression guard: added TO${String.fromCodePoint(0x034f)}DO`,
		`Regression guard: added TO${String.fromCodePoint(7)}DO`,
		'Regression guard: covered by ㅤ',
		'Regression guard: added guard.test.ts ',
		' Regression guard: added guard.test.ts'
	])('rejects markup, placeholders, invisible text, and whitespace: %s', (body) => {
		expect(verdict(body)).toMatchObject({ required: true, valid: false });
	});

	it.each([
		'Regression guard: added src/lib/convex/_generated/api.test.ts',
		'Regression guard: added src/routes/[[lang]]/guard.test.ts',
		'Regression guard: not warranted, auth and billing share A & B',
		'Regression guard: not warranted, the type guarantees count < limit',
		'Regression guard: covered by eslint/no-todo-comments',
		'Regression guard: added TODO_test'
	])('accepts practical names and reasons: %s', (body) => {
		expect(verdict(body)).toMatchObject({ required: true, valid: true });
	});

	it.each(['fix: Correct callback', 'fix!: Correct callback', 'fix(auth)!: Correct callback'])(
		'requires the conventional fix title %s',
		(title) => {
			expect(verdict('Regression guard: added guard.test.ts', title)).toMatchObject({
				required: true,
				valid: true
			});
		}
	);

	it.each(['fixtures(auth): Refresh samples', 'Fix(auth): Correct callback', 'fixup docs'])(
		'exempts the non-fix title %s',
		(title) => {
			expect(verdict('', title)).toMatchObject({ required: false, valid: true });
		}
	);

	it.each(['renovate[bot]', 'app/renovate'])('exempts the bot author %s', (author) => {
		expect(verdict('', FIX, author)).toMatchObject({ required: false, valid: true });
	});

	it('normalizes CRLF bodies', () => {
		expect(verdict('Closes #832\r\n\r\nRegression guard: added guard.test.ts\r\n')).toMatchObject({
			valid: true
		});
	});
});
