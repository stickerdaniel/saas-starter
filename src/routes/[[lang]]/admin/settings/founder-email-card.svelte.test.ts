import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { getFunctionName, type FunctionReference } from 'convex/server';
import { api } from '#lib/convex/_generated/api.js';
import type { SwitchableFounderEmail } from '#lib/convex/emails/founderEmailConfig.js';
import en from '../../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('@tolgee/svelte', async () => {
	const { translation } = await import('../support/test-fixtures/translation');
	const { default: T } = await import('../support/test-fixtures/translated-key.svelte');
	return { getTranslate: () => ({ t: translation }), T };
});

type EmailSettings = { on: boolean; subject: string; body: string };
type Settings = {
	sender: { name: string; title: string } | null;
	canEdit: boolean;
	feedback: EmailSettings;
	cancellation: EmailSettings;
};

const mocks = vi.hoisted(() => ({
	mutation: vi.fn(),
	toast: { success: vi.fn(), error: vi.fn() },
	settings: {} as Settings
}));

vi.mock('svelte-sonner', () => ({ toast: mocks.toast }));
vi.mock('convex-svelte', () => ({
	useConvexClient: () => ({ mutation: mocks.mutation }),
	useQuery: () => ({ data: mocks.settings, error: undefined, isLoading: false })
}));

import { useDictionary } from '../support/test-fixtures/translation';
import FounderEmailCard from './founder-email-card.svelte';

const emailSettings = (on: boolean): EmailSettings => ({
	on,
	subject: 'A quick question',
	body: 'Hi {{userFirstName}}, what was missing?'
});

let component: ReturnType<typeof mount> | undefined;

beforeEach(() => {
	useDictionary(en);
	mocks.mutation.mockReset();
	mocks.toast.error.mockReset();
	mocks.toast.success.mockReset();
	// The viewer is the contact person; both emails are off.
	mocks.settings = {
		sender: { name: 'Ada', title: 'Founder' },
		canEdit: true,
		feedback: emailSettings(false),
		cancellation: emailSettings(false)
	};
	vi.spyOn(console, 'error').mockImplementation(() => {});
	// The body editor's tabs measure their active trigger.
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	// bits-ui releases its body scroll lock on a timer; let it run inside jsdom.
	await new Promise((resolve) => setTimeout(resolve, 50));
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

const founder = en.admin.settings.founder_welcome;
const buttonNamed = (name: string, root: ParentNode = document) =>
	[...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === name)!;
const emailSwitch = () =>
	document.querySelector(
		`[role="switch"][aria-label="${founder.switch_label}"]`
	) as HTMLButtonElement;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const callsTo = (reference: FunctionReference<'mutation'>) =>
	mocks.mutation.mock.calls.filter(
		([called]) => getFunctionName(called) === getFunctionName(reference)
	);

function mountCard(email: SwitchableFounderEmail) {
	component = mount(FounderEmailCard, { target: document.body, props: { email } });
	flushSync();
}

describe.each(['feedback', 'cancellation'] as const)('the %s email card', (email) => {
	it('switches the email on', async () => {
		mocks.mutation.mockResolvedValue(null);
		mountCard(email);

		emailSwitch().click();
		await settle();

		expect(callsTo(api.admin.founderWelcome.mutations.setFounderEmailEnabled)).toEqual([
			[api.admin.founderWelcome.mutations.setFounderEmailEnabled, { email, enabled: true }]
		]);
		expect(mocks.toast.success).toHaveBeenCalledWith(founder.switched_on);
	});

	it('switches the email off', async () => {
		mocks.settings[email] = emailSettings(true);
		mocks.mutation.mockResolvedValue(null);
		mountCard(email);
		expect(document.body.textContent).toContain('Sending as Ada');

		emailSwitch().click();
		await settle();

		expect(callsTo(api.admin.founderWelcome.mutations.setFounderEmailEnabled)).toEqual([
			[api.admin.founderWelcome.mutations.setFounderEmailEnabled, { email, enabled: false }]
		]);
		expect(mocks.toast.success).toHaveBeenCalledWith(founder.switched_off);
	});

	it('saves the template from its dialog', async () => {
		mocks.mutation.mockResolvedValue(null);
		mountCard(email);

		buttonNamed(founder.edit_button).click();
		flushSync();
		buttonNamed(founder.save, document.querySelector('[role="dialog"]')!).click();
		await settle();

		expect(callsTo(api.admin.founderWelcome.mutations.updateFounderEmailTemplate)).toEqual([
			[
				api.admin.founderWelcome.mutations.updateFounderEmailTemplate,
				{ email, subject: 'A quick question', body: 'Hi {{userFirstName}}, what was missing?' }
			]
		]);
		expect(mocks.toast.success).toHaveBeenCalledWith(founder.template_saved);
	});
});

it('reports a failed switch and keeps the stored state', async () => {
	mocks.mutation.mockRejectedValue(new Error('backend down'));
	mountCard('feedback');

	emailSwitch().click();
	await settle();
	flushSync();

	expect(mocks.toast.error).toHaveBeenCalledWith(founder.error);
	expect(emailSwitch().getAttribute('aria-checked')).toBe('false');
	expect(emailSwitch().disabled).toBe(false);
});

it('shows the sender to other admins and leaves changes to the contact person', () => {
	mocks.settings = { ...mocks.settings, canEdit: false, feedback: emailSettings(true) };
	mountCard('feedback');

	expect(document.body.textContent).toContain('Sending as Ada');
	expect(emailSwitch().disabled).toBe(true);
	expect(buttonNamed(founder.edit_button).disabled).toBe(true);
});

it('asks for the welcome contact person first', () => {
	mocks.settings = { ...mocks.settings, sender: null, canEdit: false };
	mountCard('cancellation');

	expect(document.body.textContent).toContain(founder.needs_contact);
	expect(emailSwitch().disabled).toBe(true);
});
