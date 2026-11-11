// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ContextScope, { type ContextNode } from './ContextScope.svelte';
import { AuthFlowManager, authFlowContext } from '#lib/hooks/auth-flow.svelte.ts';
import { ClockSkewState, clockSkewContext } from '#lib/hooks/clock-skew.svelte.ts';
import { ActiveUploads, activeUploadsContext } from '#lib/hooks/active-uploads.svelte.ts';
import {
	setGlobalSearchContext,
	useGlobalSearchContext,
	type GlobalSearchContextState
} from '#lib/components/global-search/context.svelte.ts';
import { getChatUIContext, tryGetChatUIContext } from '#lib/chat/ui/chat-context.svelte.ts';

function renderScope(node: ContextNode): string {
	return render(ContextScope, { props: { node } }).body;
}

describe('Context value semantics', () => {
	it('provides unmeasured clock state to fallback consumers and shares later measurements', () => {
		let measured: ClockSkewState;
		renderScope({
			initialize: () => {
				measured = clockSkewContext.set(new ClockSkewState());
			},
			children: [
				{
					initialize: () => {
						const clock = clockSkewContext.get();
						expect(clock.skewMs).toBeNull();
						expect(clock.isSkewed).toBe(false);
						expect(clock.magnitude).toBe('');
						measured.skewMs = 600_000;
						expect(clock.isSkewed).toBe(true);
					}
				},
				{
					initialize: () => {
						expect(clockSkewContext.get()).toBe(measured);
						expect(clockSkewContext.get().isSkewed).toBe(true);
					}
				}
			]
		});
	});
});

describe('optional Context contracts', () => {
	it('keeps attachment-only chat lookup optional while the chat controls require ChatRoot', () => {
		renderScope({
			initialize: () => {
				expect(tryGetChatUIContext()).toBeUndefined();
				expect(() => getChatUIContext()).toThrow('Chat UI components must be used within ChatRoot');
			}
		});
	});
});

describe('SSR request isolation', () => {
	it('does not reuse auth, clock, search, or upload state between renders', () => {
		const requests: Array<{
			auth: AuthFlowManager;
			clock: ClockSkewState;
			search: GlobalSearchContextState;
			uploads: ActiveUploads;
		}> = [];

		function request(change: boolean): string {
			return renderScope({
				initialize: () => {
					authFlowContext.set(new AuthFlowManager());
					clockSkewContext.set(new ClockSkewState());
					setGlobalSearchContext();
					activeUploadsContext.set(new ActiveUploads());
				},
				children: [
					{
						initialize: () => {
							const state = {
								auth: authFlowContext.get(),
								clock: clockSkewContext.get(),
								search: useGlobalSearchContext(),
								uploads: activeUploadsContext.get()
							};
							requests.push(state);
							if (change) {
								state.auth.email = 'request-one@example.test';
								state.clock.skewMs = 60_000;
								state.search.openMenu();
								state.uploads.claim({});
							} else {
								expect(state.auth.email).toBe('');
								expect(state.clock.skewMs).toBeNull();
								expect(state.search.open).toBe(false);
								expect(state.uploads.any).toBe(false);
							}
							return state.auth.email;
						}
					}
				]
			});
		}

		expect(request(true)).toContain('request-one@example.test');
		expect(request(false)).not.toContain('request-one@example.test');
		for (const key of ['auth', 'clock', 'search', 'uploads'] as const) {
			expect(requests[0]?.[key]).not.toBe(requests[1]?.[key]);
		}
		// Module-scoped keys survive, but provider values must not.
		expect(() =>
			renderScope({
				initialize: () => {
					authFlowContext.get();
				}
			})
		).toThrow(/missing_context/);
		renderScope({
			initialize: () => {
				expect(activeUploadsContext.getOr(null)).toBeNull();
			}
		});
	});
});
