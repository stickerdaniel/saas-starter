/**
 * ESLint rule: require-motion-guard-transition
 *
 * Requires movement transitions (`fly`, `slide` via `transition:`/`in:`/`out:`)
 * to be gated on prefers-reduced-motion. A site is flagged when it cannot
 * possibly respect the preference: no params object at all, or a params object
 * whose property values are all plain literals. Any conditional, identifier,
 * member expression or call in a param value counts as guarded (the guard may
 * live upstream, not our call to make). `fade` is exempt: opacity-only is
 * WCAG-acceptable.
 *
 * Why: fly/slide move content, which prefers-reduced-motion users opted out
 * of (#475). The repo's two sanctioned styles both gate through `svelte/motion`:
 * `duration: skipTransition ? 0 : 200` (sliding-header.svelte) and
 * `y: prefersReducedMotion.current ? 0 : 10` (ConversationScrollButton.svelte).
 *
 * ❌ <div in:fly></div>
 * ❌ <div in:fly={{ y: 10, duration: 200 }}></div>
 * ✅ <div in:fly={{ y: prefersReducedMotion.current ? 0 : 10, duration: 200 }}></div>
 * ✅ <div transition:slide={{ duration: prefersReducedMotion.current ? 0 : 200 }}></div>
 * ✅ <div in:fade={{ duration: 150 }}></div>
 */

const MOVEMENT_TRANSITIONS = new Set(['fly', 'slide']);

/** Plain literal param value: 10, 'linear', or a negative number like -20. */
function isPlainLiteral(value) {
	if (!value) return false;
	if (value.type === 'Literal') return true;
	if (
		value.type === 'UnaryExpression' &&
		value.operator === '-' &&
		value.argument?.type === 'Literal'
	) {
		return true;
	}
	return false;
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Require fly/slide transition params to be gated on prefers-reduced-motion'
		},
		schema: [],
		messages: {
			unguardedMovementTransition:
				"Movement transitions (fly, slide) must honor prefers-reduced-motion. Gate the offset or duration on prefersReducedMotion from 'svelte/motion', e.g. duration: prefersReducedMotion.current ? 0 : 200."
		}
	},
	create(context) {
		return {
			SvelteDirective(node) {
				// Covers transition:, in: and out: directives.
				if (node.kind !== 'Transition') return;

				const transitionName = node.key?.name?.name;
				if (!MOVEMENT_TRANSITIONS.has(transitionName)) return;

				const params = node.expression;

				// in:fly with no params: default offsets, nothing can zero them.
				if (!params) {
					context.report({ node, messageId: 'unguardedMovementTransition' });
					return;
				}

				// in:fly={params} / in:fly={makeParams()}: the guard may live upstream.
				if (params.type !== 'ObjectExpression') return;

				for (const property of params.properties) {
					// A spread may carry a guarded value; skip to avoid false positives.
					if (property.type === 'SpreadElement') return;
					// Conditional/identifier/member/call values count as guarded.
					if (!isPlainLiteral(property.value)) return;
				}

				// Empty object or all-literal params: motion is unconditional.
				context.report({ node, messageId: 'unguardedMovementTransition' });
			}
		};
	}
};
