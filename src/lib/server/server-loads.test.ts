// @vitest-environment node
import { isValidationError, type ServerLoadEvent } from '@sveltejs/kit';
import { getFunctionName, type FunctionReference } from 'convex/server';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

const fake = vi.hoisted(() => ({
	replies: new Map<string, (args: unknown) => Promise<unknown>>(),
	sentry: { captureException: (..._args: unknown[]) => {} },
	construct: () => {}
}));

vi.mock('$app/env', () => ({ dev: false, browser: false, building: false, version: 'test' }));
vi.mock('#lib/monitoring/sentry.js', () => ({ loadedSentry: () => fake.sentry }));
vi.mock('$app/server', () => ({
	form: (_schema: unknown, handler: object) => Object.assign(handler, { __: { type: 'form' } }),
	getRequestEvent: () => remoteEvent
}));
vi.mock('#lib/server/convex-http.js', () => {
	const call = (reference: FunctionReference<'query' | 'mutation'>, args: unknown) => {
		const reply = fake.replies.get(getFunctionName(reference));
		if (!reply) throw new Error(`no reply for ${getFunctionName(reference)}`);
		return reply(args);
	};
	return {
		createServerConvexHttpClient: () => {
			fake.construct();
			return { query: vi.fn(call), mutation: vi.fn(call) };
		}
	};
});

const { load: signinLoad } = await import('../../routes/[[lang]]/(auth)/signin/+page.server');
const { load: signupLoad } = await import('../../routes/[[lang]]/(auth)/signup/+page.server');
const { load: adminUsersLoad } = await import('../../routes/[[lang]]/admin/users/+page.server');
const { load: aiChatLoad } = await import('../../routes/[[lang]]/app/ai-chat/+page.server');
const { load: communityChatLoad } =
	await import('../../routes/[[lang]]/app/community-chat/+page.server');
const { load: settingsLoad } = await import('../../routes/[[lang]]/app/settings/+page.server');
const { load: rootLayoutLoad } = await import('../../routes/+layout.server');
const { addEmailForm } = await import('../../routes/[[lang]]/admin/settings/data.remote');

const PROVIDERS = { google: true, github: false };
const VIEWER = { _id: 'user_1', name: 'Ada', email: 'ada@example.com', image: null };
const MESSAGES = [{ _id: 'message_1', body: 'hello' }];
const USABILITY = {
	billing: { usable: false, reason: 'unavailable' },
	ai: { usable: true }
};

let remoteEvent: ServerLoadEvent;
let consoles: { warn: MockInstance; error: MockInstance };
let capture: MockInstance;

const answer = (name: string, value: unknown) =>
	fake.replies.set(name, async () => structuredClone(value));
const refuse = (name: string, error: unknown) =>
	fake.replies.set(name, async () => {
		throw error;
	});
function hold(name: string, value: unknown) {
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	fake.replies.set(name, async () => {
		await released;
		return structuredClone(value);
	});
	return release;
}

const encode = (value: Record<string, unknown>) =>
	Buffer.from(JSON.stringify(value)).toString('base64url');
const JWT = `${encode({ alg: 'RS256' })}.${encode({ sub: 'user_1', name: 'Ada from JWT', exp: 4_102_444_800 })}.signature`;

function fakeEvent<Event extends ServerLoadEvent = ServerLoadEvent>(
	locals: Partial<App.Locals> = {},
	extra: { parent?: () => Promise<unknown>; signal?: AbortSignal; isDataRequest?: boolean } = {}
): Event {
	return {
		locals,
		depends: vi.fn(),
		url: new URL('https://example.com/en/app'),
		request: new Request('https://example.com/en/app', { signal: extra.signal }),
		cookies: { get: () => undefined },
		parent: extra.parent ?? (async () => ({})),
		isDataRequest: extra.isDataRequest ?? false
	} as unknown as Event;
}

const lines = (level: 'warn' | 'error') =>
	consoles[level].mock.calls.map((args) => args.map(String).join(' '));
const unauthenticated = () => new ConvexError({ code: 'UNAUTHENTICATED' });

beforeEach(() => {
	fake.replies.clear();
	fake.construct = () => {};
	capture = vi.spyOn(fake.sentry, 'captureException').mockImplementation(() => {});
	consoles = {
		warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
		error: vi.spyOn(console, 'error').mockImplementation(() => {})
	};
	answer('auth:getAvailableOAuthProviders', PROVIDERS);
	answer('users:viewer', VIEWER);
	answer('messages:list', MESSAGES);
	answer('users:hasPassword', true);
	answer('capabilities:getUsability', USABILITY);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe.each([
	['signin', signinLoad],
	['signup', signupLoad],
	['admin/users', adminUsersLoad]
])('the %s load', (label, load) => {
	const fallback = { oauthProviders: { google: false, github: false } };

	it('returns the OAuth providers', async () => {
		await expect(load()).resolves.toEqual({ oauthProviders: PROVIDERS });
		expect(lines('error')).toEqual([]);
	});

	it('falls back and reports a failure with the thrown error', async () => {
		const failure = new Error('backend down');
		refuse('auth:getAvailableOAuthProviders', failure);

		await expect(load()).resolves.toEqual(fallback);
		expect(lines('error')).toEqual([
			expect.stringMatching(new RegExp(`^\\[${label}\\] OAuth provider lookup failed `))
		]);
		expect(capture).toHaveBeenCalledOnce();
		expect(capture.mock.calls[0]?.[0]).toBe(failure);
	});

	it('falls back on a refusal with one warning and no capture', async () => {
		refuse('auth:getAvailableOAuthProviders', unauthenticated());

		await expect(load()).resolves.toEqual(fallback);
		expect(lines('warn')).toEqual([expect.stringContaining('code=UNAUTHENTICATED')]);
		expect(lines('error')).toEqual([]);
		expect(capture).not.toHaveBeenCalled();
	});

	it('falls back when the client cannot be built', async () => {
		const failure = new Error('CONVEX_INTERNAL_URL missing');
		fake.construct = () => {
			throw failure;
		};

		await expect(load()).resolves.toEqual(fallback);
		expect(capture.mock.calls[0]?.[0]).toBe(failure);
	});
});

describe('the ai-chat load', () => {
	it('returns the viewer', async () => {
		await expect(aiChatLoad(fakeEvent({ token: JWT }))).resolves.toEqual({ viewer: VIEWER });
	});

	it('falls back to no viewer on a failure', async () => {
		refuse('users:viewer', new Error('backend down'));

		await expect(aiChatLoad(fakeEvent({ token: JWT }))).resolves.toEqual({ viewer: null });
		expect(lines('error')).toEqual([expect.stringMatching(/^\[ai-chat\] Viewer lookup failed /)]);
	});

	it('finishes the lookup after the client disconnects', async () => {
		const disconnect = new AbortController();
		const release = hold('users:viewer', VIEWER);
		const pending = aiChatLoad(fakeEvent({ token: JWT }, { signal: disconnect.signal }));

		disconnect.abort();
		release();

		await expect(pending).resolves.toEqual({ viewer: VIEWER });
		expect(lines('error')).toEqual([]);
	});
});

describe('the community-chat load', () => {
	it('asks for the viewer and the messages at once', async () => {
		const asked: string[] = [];
		let release!: () => void;
		const released = new Promise<void>((resolve) => (release = resolve));
		for (const [name, value] of [
			['users:viewer', VIEWER],
			['messages:list', MESSAGES]
		] as const) {
			fake.replies.set(name, async () => {
				asked.push(name);
				await released;
				return structuredClone(value);
			});
		}

		const pending = communityChatLoad(fakeEvent({ token: JWT }));
		await vi.waitFor(() => expect(asked.toSorted()).toEqual(['messages:list', 'users:viewer']));
		release();

		await expect(pending).resolves.toEqual({ viewer: VIEWER, messages: MESSAGES });
	});

	it.each([
		['users:viewer', { viewer: null, messages: MESSAGES }, 'Viewer lookup failed'],
		['messages:list', { viewer: VIEWER, messages: [] }, 'Messages lookup failed']
	])('keeps the other half when %s fails', async (name, expected, label) => {
		refuse(name, new Error('backend down'));

		await expect(communityChatLoad(fakeEvent({ token: JWT }))).resolves.toEqual(expected);
		expect(lines('error')).toEqual([
			expect.stringMatching(new RegExp(`^\\[community-chat\\] ${label} `))
		]);
	});

	it('falls back to both defaults when the client cannot be built', async () => {
		fake.construct = () => {
			throw new Error('CONVEX_INTERNAL_URL missing');
		};

		await expect(communityChatLoad(fakeEvent({ token: JWT }))).resolves.toEqual({
			viewer: null,
			messages: []
		});
		expect(lines('error')).toEqual([
			expect.stringMatching(/^\[community-chat\] Convex client unavailable /)
		]);
	});
});

describe('the settings load', () => {
	const parentData = { viewer: { ...VIEWER, emailVerified: true } };

	it('returns the password flag and the parent viewer', async () => {
		await expect(
			settingsLoad(fakeEvent({ token: JWT }, { parent: async () => parentData }))
		).resolves.toEqual({
			hasPassword: true,
			user: { name: 'Ada', email: 'ada@example.com', image: null, emailVerified: true }
		});
	});

	it('asks for the password flag before the parent data arrives', async () => {
		let releaseParent!: () => void;
		const parent = () =>
			new Promise<typeof parentData>((resolve) => (releaseParent = () => resolve(parentData)));
		const asked = vi.fn(async () => true);
		fake.replies.set('users:hasPassword', asked);

		const pending = settingsLoad(fakeEvent({ token: JWT }, { parent }));
		await vi.waitFor(() => expect(asked).toHaveBeenCalledOnce());
		releaseParent();

		await expect(pending).resolves.toMatchObject({ hasPassword: true });
	});

	it('falls back to an unknown password flag on a failure', async () => {
		refuse('users:hasPassword', new Error('backend down'));

		await expect(
			settingsLoad(fakeEvent({ token: JWT }, { parent: async () => parentData }))
		).resolves.toMatchObject({ hasPassword: null, user: { name: 'Ada' } });
		expect(lines('error')).toEqual([
			expect.stringMatching(/^\[settings\] hasPassword lookup failed /)
		]);
	});

	it('lets a parent failure escape as the same error', async () => {
		const failure = new Error('parent load failed');

		await expect(
			settingsLoad(
				fakeEvent(
					{ token: JWT },
					{
						parent: async () => {
							throw failure;
						}
					}
				)
			)
		).rejects.toBe(failure);
	});
});

describe('the root layout load', () => {
	it('returns the viewer, the capabilities and the session hint', async () => {
		await expect(
			rootLayoutLoad(fakeEvent({ token: JWT, sidebarOpen: true }))
		).resolves.toMatchObject({
			authState: { isAuthenticated: true, hasSession: false },
			viewer: VIEWER,
			capabilities: USABILITY,
			autumnState: { customer: null },
			hasAuthSession: false,
			sidebarOpen: true
		});
	});

	it('falls back to the JWT viewer on a refused viewer lookup', async () => {
		refuse('users:viewer', unauthenticated());

		await expect(rootLayoutLoad(fakeEvent({ token: JWT }))).resolves.toMatchObject({
			viewer: { _id: 'user_1', name: 'Ada from JWT' },
			capabilities: USABILITY
		});
		expect(lines('warn')).toEqual([
			expect.stringMatching(/^\[auth-layout-data\] Viewer lookup failed.*code=UNAUTHENTICATED/)
		]);
		expect(capture).not.toHaveBeenCalled();
	});

	it('falls back to the JWT viewer and no capabilities without a client', async () => {
		const failure = new Error('CONVEX_INTERNAL_URL missing');
		fake.construct = () => {
			throw failure;
		};

		await expect(rootLayoutLoad(fakeEvent({ token: JWT }))).resolves.toMatchObject({
			viewer: { _id: 'user_1', name: 'Ada from JWT' },
			capabilities: { billing: { usable: false }, ai: { usable: false } },
			autumnState: { customer: null }
		});
		expect(capture.mock.calls[0]?.[0]).toBe(failure);
	});
});

describe('the add email form', () => {
	const issue = { email: (message: string) => ({ message, path: ['email'] }) };
	const submit = () =>
		(
			addEmailForm as unknown as (
				input: { email: string },
				issues: typeof issue
			) => Promise<unknown>
		)({ email: ' Ops@Example.com ' }, issue);

	beforeEach(() => {
		remoteEvent = fakeEvent({ token: JWT });
	});

	it('adds the normalized address', async () => {
		const added = vi.fn(async () => null);
		fake.replies.set('admin/notificationPreferences/mutations:addCustomEmail', added);

		await expect(submit()).resolves.toEqual({ success: true });
		expect(added).toHaveBeenCalledWith({ email: 'ops@example.com' });
	});

	it('turns a duplicate address into a field issue', async () => {
		refuse(
			'admin/notificationPreferences/mutations:addCustomEmail',
			new ConvexError({ code: 'notification_email_already_exists' })
		);

		const rejection = await submit().catch((error: unknown) => error);
		expect(isValidationError(rejection)).toBe(true);
		expect(rejection).toMatchObject({
			issues: [{ message: 'admin.settings.email_exists', path: ['email'] }]
		});
	});

	it('lets any other failure escape as the same error', async () => {
		const failure = new ConvexError({ code: 'FORBIDDEN' });
		refuse('admin/notificationPreferences/mutations:addCustomEmail', failure);

		await expect(submit()).rejects.toBe(failure);
	});
});
