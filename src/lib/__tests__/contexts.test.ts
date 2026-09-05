// @vitest-environment node
import { describe, expect, expectTypeOf, it } from 'vitest';
import { render } from 'svelte/server';
import ContextScope, { type ContextNode } from './ContextScope.svelte';
import { AuthFlowManager, authFlowContext } from '$lib/hooks/auth-flow.svelte.ts';
import { ClockSkewState, clockSkewContext } from '$lib/hooks/clock-skew.svelte.ts';
import {
	AdminSupportUIManager,
	adminSupportUIContext
} from '$lib/hooks/admin-support-ui.svelte.ts';
import { ActiveUploads, activeUploadsContext } from '$lib/hooks/active-uploads.svelte.ts';
import {
	SupportContext,
	supportContext
} from '$lib/components/customer-support/support-context.svelte.ts';
import {
	ScreenshotEditorState,
	screenshotEditorContext
} from '$lib/components/customer-support/screenshot-editor/screenshot-editor-context.svelte.ts';
import {
	setGlobalSearchContext,
	useGlobalSearchContext,
	type GlobalSearchContextState
} from '$lib/components/global-search/context.svelte.ts';
import {
	type BillingCheckoutManager,
	setBillingCheckoutContext,
	useBillingCheckout,
	type BillingCheckoutDeps
} from '$lib/components/billing/checkout-context.svelte.ts';
import { languageContext, useLanguage } from '$lib/i18n/context';
import { getChatUIContext, tryGetChatUIContext } from '$lib/chat/ui/chat-context.svelte.ts';
import { getAdminViewerId, setAdminViewerId } from '../../routes/[[lang]]/admin/viewer-context';
import {
	getUserActionHandler,
	setUserActionHandler
} from '../../routes/[[lang]]/admin/users/user-actions-context';
import type { ActionEvent } from '../../routes/[[lang]]/admin/users/data-table-actions.svelte';
import {
	getTogglePreferenceContext,
	setTogglePreferenceContext,
	getRemoveEmailContext,
	setRemoveEmailContext,
	getRowSelectionContext,
	setRowSelectionContext,
	getRecipientsContext,
	setRecipientsContext,
	type ToggleField
} from '../../routes/[[lang]]/admin/settings/recipients-context';
import type { RowSelectionState } from '@tanstack/table-core';
import type { NotificationRecipient } from '$lib/convex/admin/notificationPreferences/queries';

function renderScope(node: ContextNode): string {
	return render(ContextScope, { props: { node } }).body;
}

function billingDeps(): BillingCheckoutDeps {
	return {
		checkout: { error: null, execute: async () => null },
		attach: { error: null, execute: async () => null },
		redirect: () => {},
		onError: () => {}
	};
}

// Exercise real Svelte providers and consumers rather than mocking the Context API.
const requiredContexts = [
	{
		name: 'auth flow',
		provide: () => authFlowContext.set(new AuthFlowManager()),
		use: authFlowContext.get
	},
	{
		name: 'clock skew',
		provide: () => clockSkewContext.set(new ClockSkewState()),
		use: clockSkewContext.get
	},
	{
		name: 'admin support UI',
		provide: () => adminSupportUIContext.set(new AdminSupportUIManager()),
		use: adminSupportUIContext.get
	},
	{
		name: 'support composition root',
		provide: () => supportContext.set(new SupportContext()),
		use: supportContext.get
	},
	{
		name: 'screenshot editor',
		provide: () => screenshotEditorContext.set(new ScreenshotEditorState({})),
		use: screenshotEditorContext.get
	},
	{
		name: 'global search',
		provide: setGlobalSearchContext,
		use: useGlobalSearchContext
	},
	{
		name: 'billing checkout',
		provide: () => setBillingCheckoutContext(billingDeps()),
		use: useBillingCheckout
	},
	{
		name: 'language',
		provide: () => languageContext.set(() => 'de'),
		use: languageContext.get
	},
	{
		name: 'admin viewer snapshot',
		provide: () => setAdminViewerId(crypto.randomUUID()),
		use: getAdminViewerId
	},
	{
		name: 'admin user actions',
		provide: () => setUserActionHandler(() => {}),
		use: getUserActionHandler
	},
	{
		name: 'recipient toggle handler',
		provide: () => setTogglePreferenceContext(async () => {}),
		use: getTogglePreferenceContext
	},
	{
		name: 'recipient removal handler',
		provide: () => setRemoveEmailContext(async () => {}),
		use: getRemoveEmailContext
	},
	{
		name: 'recipient selection getter',
		provide: () => setRowSelectionContext(() => ({})),
		use: getRowSelectionContext
	},
	{
		name: 'recipient rows getter',
		provide: () => setRecipientsContext(() => []),
		use: getRecipientsContext
	}
];

describe.each(requiredContexts)('$name Context', ({ provide, use }) => {
	it('returns the provided value to the provider and its descendants', () => {
		let provided: unknown;
		renderScope({
			initialize: () => {
				provided = provide();
				expect(use()).toBe(provided);
			},
			children: [
				{
					initialize: () => {
						expect(use()).toBe(provided);
					}
				}
			]
		});
	});

	it('fails at consumption when the required provider is absent', () => {
		expect(() =>
			renderScope({
				initialize: () => {
					use();
				}
			})
		).toThrow(/missing_context/);
	});

	it('selects the closest provider without changing the parent or sibling scope', () => {
		let outer: unknown;
		let inner: unknown;
		renderScope({
			initialize: () => {
				outer = provide();
			},
			children: [
				{
					initialize: () => {
						expect(use()).toBe(outer);
						inner = provide();
						expect(inner).not.toBe(outer);
					},
					children: [
						{
							initialize: () => {
								expect(use()).toBe(inner);
							}
						}
					]
				},
				{
					initialize: () => {
						expect(use()).toBe(outer);
					}
				}
			]
		});
	});
});

describe('Context value semantics', () => {
	it('distinguishes a provided undefined viewer snapshot from a missing provider', () => {
		renderScope({
			initialize: () => {
				setAdminViewerId(undefined);
			},
			children: [
				{
					initialize: () => {
						expect(getAdminViewerId()).toBeUndefined();
					}
				}
			]
		});
	});

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

	it('keeps language as a live getter instead of freezing the current locale', () => {
		let language = 'de';
		renderScope({
			initialize: () => {
				languageContext.set(() => language);
			},
			children: [
				{
					initialize: () => {
						const getLanguage = languageContext.get();
						expect(useLanguage()).toBe('de');
						language = 'fr';
						expect(getLanguage()).toBe('fr');
						expect(useLanguage()).toBe('fr');
					}
				}
			]
		});
	});

	it('requires the root language provider instead of silently substituting English', () => {
		expect(() => renderScope({ initialize: useLanguage })).toThrow(/missing_context/);
	});

	it('keeps selection and optimistic-recipient getters live', () => {
		let selection: RowSelectionState = {};
		let recipients: NotificationRecipient[] = [];
		renderScope({
			initialize: () => {
				setRowSelectionContext(() => selection);
				setRecipientsContext(() => recipients);
			},
			children: [
				{
					initialize: () => {
						const getSelection = getRowSelectionContext();
						const getRows = getRecipientsContext();
						const previousSelection = getSelection();
						const previousRows = getRows();
						selection = { 'selected@example.test': true };
						recipients = [];
						expect(getSelection()).toBe(selection);
						expect(getSelection()).not.toBe(previousSelection);
						expect(getRows()).toBe(recipients);
						expect(getRows()).not.toBe(previousRows);
					}
				}
			]
		});
	});

	it('dispatches user actions through the provider-owned handler', () => {
		const actions: ActionEvent[] = [];
		renderScope({
			initialize: () => {
				setUserActionHandler((action) => {
					actions.push(action);
				});
			},
			children: [
				{
					initialize: () => {
						getUserActionHandler()({ type: 'impersonate', userId: 'target-user' });
					}
				}
			]
		});
		expect(actions).toEqual([{ type: 'impersonate', userId: 'target-user' }]);
	});
});

describe('optional Context contracts', () => {
	it('allows isolated upload surfaces to use their exact fallback without installing a provider', () => {
		const fallback = new ActiveUploads();
		renderScope({
			initialize: () => {
				expect(activeUploadsContext.exists()).toBe(false);
				expect(activeUploadsContext.getOr(null)).toBeNull();
				expect(activeUploadsContext.getOr(fallback)).toBe(fallback);
				expect(activeUploadsContext.exists()).toBe(false);
				expect(() => activeUploadsContext.get()).toThrow('Context "active-uploads" not found');
			}
		});
	});

	it('shares the nearest upload registry and does not let a nested provider replace a sibling registry', () => {
		const outer = new ActiveUploads();
		const inner = new ActiveUploads();
		const owner = {};
		renderScope({
			initialize: () => {
				activeUploadsContext.set(outer);
			},
			children: [
				{
					initialize: () => {
						activeUploadsContext.set(inner);
					},
					children: [
						{
							initialize: () => {
								expect(activeUploadsContext.exists()).toBe(true);
								expect(activeUploadsContext.getOr(null)).toBe(inner);
								activeUploadsContext.get().claim(owner);
							}
						}
					]
				},
				{
					initialize: () => {
						expect(activeUploadsContext.get()).toBe(outer);
						expect(outer.any).toBe(false);
						expect(inner.any).toBe(true);
					}
				}
			]
		});
	});

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

describe('Context API types', () => {
	it('preserves exact manager, callback, optional-value, and fallback types', () => {
		expectTypeOf(authFlowContext.get).returns.toEqualTypeOf<AuthFlowManager>();
		expectTypeOf(authFlowContext.set).parameter(0).toEqualTypeOf<AuthFlowManager>();
		expectTypeOf(clockSkewContext.set).parameter(0).toEqualTypeOf<ClockSkewState>();
		expectTypeOf(adminSupportUIContext.set).parameter(0).toEqualTypeOf<AdminSupportUIManager>();
		expectTypeOf(supportContext.set).parameter(0).toEqualTypeOf<SupportContext>();
		expectTypeOf(screenshotEditorContext.set).parameter(0).toEqualTypeOf<ScreenshotEditorState>();
		expectTypeOf(useGlobalSearchContext).returns.toEqualTypeOf<GlobalSearchContextState>();
		expectTypeOf(setGlobalSearchContext).returns.toEqualTypeOf<GlobalSearchContextState>();
		expectTypeOf(useBillingCheckout).returns.toEqualTypeOf<BillingCheckoutManager>();
		expectTypeOf(setBillingCheckoutContext).parameter(0).toEqualTypeOf<BillingCheckoutDeps>();
		expectTypeOf(languageContext.set).parameter(0).toEqualTypeOf<() => string>();
		expectTypeOf(languageContext.get).returns.toEqualTypeOf<() => string>();
		expectTypeOf(useLanguage).returns.toEqualTypeOf<string>();
		expectTypeOf(setAdminViewerId).parameter(0).toEqualTypeOf<string | undefined>();
		expectTypeOf(getAdminViewerId).returns.toEqualTypeOf<string | undefined>();
		expectTypeOf(setUserActionHandler).parameter(0).toEqualTypeOf<(event: ActionEvent) => void>();
		expectTypeOf(getUserActionHandler).returns.toEqualTypeOf<(event: ActionEvent) => void>();
		expectTypeOf(setTogglePreferenceContext)
			.parameter(0)
			.toEqualTypeOf<(email: string, field: ToggleField, currentValue: boolean) => Promise<void>>();
		expectTypeOf(getRemoveEmailContext).returns.toEqualTypeOf<(email: string) => Promise<void>>();
		expectTypeOf(getRowSelectionContext).returns.toEqualTypeOf<() => RowSelectionState>();
		expectTypeOf(getRecipientsContext).returns.toEqualTypeOf<() => NotificationRecipient[]>();
		expectTypeOf<
			ReturnType<typeof activeUploadsContext.getOr<null>>
		>().toEqualTypeOf<ActiveUploads | null>();
		expectTypeOf(tryGetChatUIContext).returns.toEqualTypeOf<
			ReturnType<typeof getChatUIContext> | undefined
		>();
	});
});
