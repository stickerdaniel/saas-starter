/**
 * ESLint rule: no-bare-test-skip
 *
 * Flags bare runtime `test.skip()` calls (zero arguments) in Playwright
 * e2e specs.
 *
 * Why: a bare `test.skip()` inside a test body is the timing-race dodge:
 * the test snapshots some state once and gives up instead of waiting (#508,
 * #491). Legitimate environment gating passes a condition and a reason:
 * `test.skip(condition, 'reason')` (see e2e/signin-last-used-badge.spec.ts
 * gating on hasGoogleOAuth).
 *
 * ❌ if ((await rows.count()) === 0) test.skip();
 * ✅ test.skip(!hasGoogleOAuth, 'Google OAuth is disabled in this environment');
 * ✅ await expect(locator).toBeVisible();
 */
export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow bare test.skip() (zero arguments) in e2e specs'
		},
		schema: [],
		messages: {
			bareTestSkip:
				"Bare test.skip() dodges a timing race. Make the test deterministic with auto-waiting assertions (expect(locator).toBeVisible(), expect.poll) or gate on the environment with test.skip(condition, 'reason')."
		}
	},
	create(context) {
		return {
			CallExpression(node) {
				const callee = node.callee;
				if (
					callee?.type === 'MemberExpression' &&
					!callee.computed &&
					callee.object?.type === 'Identifier' &&
					callee.object.name === 'test' &&
					callee.property?.type === 'Identifier' &&
					callee.property.name === 'skip' &&
					node.arguments.length === 0
				) {
					context.report({ node, messageId: 'bareTestSkip' });
				}
			}
		};
	}
};
