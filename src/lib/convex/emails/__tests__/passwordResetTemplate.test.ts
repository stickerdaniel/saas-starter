import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { renderPasswordResetEmail } from '../templates';
import en from '../../../../i18n/en.json';

/**
 * Better Auth sends the reset mail for an account that has never had a password,
 * and its link works there: resetPassword creates the missing credential account.
 * Only the wording has to know the difference, so it is the wording that is
 * asserted here rather than the delivery.
 */
describe('renderPasswordResetEmail', () => {
	// The renderer resolves asset URLs from the Convex environment, which a unit
	// run does not have.
	beforeAll(() => {
		vi.stubEnv('EMAIL_ASSET_URL', 'https://assets.example.test');
	});
	afterAll(() => {
		vi.unstubAllEnvs();
	});

	const url = 'https://example.com/reset?token=abc';
	// The HTML half escapes the copy, so compare it against the same source text
	// rather than a second hand-written copy of every sentence.
	const unescape = (rendered: string) =>
		rendered.replaceAll('&#39;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&');
	const reset = en.email.reset_password;
	const set = en.email.set_password;

	it('reports a reset for an account that has a password', () => {
		const { html, text } = renderPasswordResetEmail(url, undefined, 'en', true);
		for (const rendered of [unescape(html), text]) {
			expect(rendered).toContain(reset.body);
			expect(rendered).not.toContain(set.body);
		}
	});

	it('reports a first password for an account that has none', () => {
		const { html, text } = renderPasswordResetEmail(url, undefined, 'en', false);
		for (const rendered of [unescape(html), text]) {
			expect(rendered).toContain(set.body);
			expect(rendered).not.toContain(reset.body);
		}
	});

	// The disclaimer is the sentence that is actively false for an account with no
	// password: nothing "remains unchanged" when there is nothing to change.
	it('never promises an unchanged password to an account without one', () => {
		const { html, text } = renderPasswordResetEmail(url, undefined, 'en', false);
		for (const rendered of [unescape(html), text]) {
			expect(rendered).not.toContain(reset.disclaimer);
			expect(rendered).toContain(set.disclaimer);
		}
	});

	it('defaults to the reset wording, so an older queued call is unchanged', () => {
		expect(unescape(renderPasswordResetEmail(url, undefined, 'en').html)).toContain(reset.body);
	});
});
