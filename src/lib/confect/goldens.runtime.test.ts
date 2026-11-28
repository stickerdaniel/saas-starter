// @vitest-environment node
/// <reference types="vite/client" />
import type * as BetterAuth from '@convex-dev/better-auth';
import { convexTest } from 'convex-test';
import {
	createFunctionHandle,
	getFunctionName,
	makeFunctionReference,
	type FunctionReference,
	type FunctionVisibility
} from 'convex/server';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { goldenText } from './goldens';
import { components } from '../convex/_generated/api';
import authSchema from '../convex-components/betterAuth/schema';
import schema from '../convex/schema';
import { getCounters } from './admin/counters';
import { preloadComponent } from './convexComponents.fixtures';
import { convexModules, preloadModules } from './convexTest.modules';
import { resend } from './emails/resend';

const authClients = vi.hoisted(async () => {
	const { readFileSync } = await import('node:fs');
	const declared = [
		...readFileSync('.env-convex.schema', 'utf8').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)
	];
	for (const [, name] of declared) vi.stubEnv(name!, undefined);
	vi.stubEnv('AUTH_E2E_TEST_SECRET', undefined);
	vi.stubEnv('CONVEX_SITE_URL', 'https://goldens.convex.site');
	vi.stubEnv('SITE_URL', 'https://goldens.test');
	vi.stubEnv('BETTER_AUTH_SECRET', 'goldens-better-auth-secret-of-sufficient-length');
	return { configs: new Array<AuthClientConfig>() };
});

type AuthClientConfig = Parameters<typeof BetterAuth.createClient>[1];

vi.mock('@convex-dev/better-auth', async (importOriginal) => {
	const original = await importOriginal<typeof BetterAuth>();
	const { configs } = await authClients;
	return {
		...original,
		createClient: (...args: Parameters<typeof original.createClient>) => {
			configs.push(args[1]);
			return original.createClient(...args);
		}
	};
});

const betterAuthModules = await preloadModules(
	import.meta.glob('../convex-components/betterAuth/**/*.ts')
);
const installedComponents = {
	rateLimiter: await preloadComponent.rateLimiter(),
	resend: await preloadComponent.resend(),
	agent: await preloadComponent.agent(),
	convexFilesControl: await preloadComponent.convexFilesControl()
};

const NATIVE = '../convex/';
const PROBE_MODULE = 'goldenReturnProbe';
const AUTHORED_ENTRY_FILES = new Set([
	'schema.ts',
	'http.ts',
	'crons.ts',
	'auth.config.ts',
	'convex.config.ts'
]);
const SETTLE_MS = 10_000;
const realSetTimeout = globalThis.setTimeout;

const golden = (name: string) => `./__goldens__/${name}`;

type Kind = 'query' | 'mutation' | 'action';
type Published = {
	path: string;
	kind: Kind;
	visibility: 'public' | 'internal';
	registered: object;
	args: unknown;
	returns: unknown;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null;
}

function field(value: unknown, key: string): unknown {
	return isRecord(value) || typeof value === 'function' ? Reflect.get(value, key) : undefined;
}

function exportedJson(value: object, method: 'exportArgs' | 'exportReturns'): unknown {
	const exporter: unknown = field(value, method);
	if (typeof exporter !== 'function') throw new Error(`no ${method}`);
	return JSON.parse(String(exporter.call(value)));
}

function kindOf(value: unknown): Kind | undefined {
	if (field(value, 'isQuery') === true) return 'query';
	if (field(value, 'isMutation') === true) return 'mutation';
	if (field(value, 'isAction') === true) return 'action';
	return undefined;
}

async function publishedFunctions(): Promise<Published[]> {
	const found: Published[] = [];
	for (const key of Object.keys(convexModules).sort()) {
		const file = key.slice(NATIVE.length);
		if (file.startsWith('_generated/') || AUTHORED_ENTRY_FILES.has(file)) continue;
		const loaded = await convexModules[key]!();
		if (!isRecord(loaded)) continue;
		for (const [name, registered] of Object.entries(loaded).sort(([a], [b]) =>
			a < b ? -1 : a > b ? 1 : 0
		)) {
			const kind = kindOf(registered);
			if (!kind || typeof registered !== 'function') continue;
			found.push({
				path: `${file.replace(/\.ts$/, '')}:${name}`,
				kind,
				visibility: field(registered, 'isPublic') === true ? 'public' : 'internal',
				registered,
				args: exportedJson(registered, 'exportArgs'),
				returns: exportedJson(registered, 'exportReturns')
			});
		}
	}
	return found;
}

function minimalValue(validator: unknown): unknown {
	const type = field(validator, 'type');
	switch (type) {
		case 'null':
		case 'any':
			return null;
		case 'number':
			return 0;
		case 'bigint':
			return 0n;
		case 'boolean':
			return false;
		case 'string':
			return 'golden';
		case 'bytes':
			return new ArrayBuffer(0);
		case 'literal':
			return field(validator, 'value');
		case 'id':
			return `1${String(field(validator, 'tableName'))}`;
		case 'array':
			return [];
		case 'record':
			return {};
		case 'union': {
			const members = field(validator, 'value');
			if (!Array.isArray(members) || members.length === 0) throw new Error('empty union');
			return minimalValue(members[0]);
		}
		case 'object': {
			const fields = field(validator, 'value');
			return Object.fromEntries(
				Object.entries(isRecord(fields) ? fields : {})
					.filter(([, definition]) => field(definition, 'optional') !== true)
					.map(([name, definition]) => [name, minimalValue(field(definition, 'fieldType'))])
			);
		}
	}
	throw new Error(`no minimal value for a ${String(type)} validator`);
}

function minimalArgs(validator: unknown): Record<string, unknown> {
	const value = field(validator, 'type') === 'object' ? minimalValue(validator) : {};
	return isRecord(value) ? { ...value } : {};
}

function describeError(error: unknown): string {
	if (error instanceof ConvexError) return `ConvexError ${JSON.stringify(error.data)}`;
	const message = error instanceof Error ? error.message : String(error);
	return `Error ${message.replaceAll(process.cwd(), '<root>').replace(/\s*\n\s*/g, ' ')}`;
}

async function settle(call: () => Promise<unknown>): Promise<string> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<string>((resolve) => {
		timer = realSetTimeout(() => resolve(`unsettled after ${SETTLE_MS} ms`), SETTLE_MS);
	});
	try {
		return await Promise.race([
			call().then(
				() => 'ok',
				(error: unknown) => describeError(error)
			),
			deadline
		]);
	} finally {
		clearTimeout(timer);
	}
}

function harness(extraModules: Record<string, () => Promise<unknown>> = {}) {
	const t = convexTest(schema, { ...convexModules, ...extraModules });
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	for (const component of Object.values(installedComponents)) component.register(t);
	return t;
}

type Harness = ReturnType<typeof harness>;
type Caller = Pick<Harness, 'query' | 'mutation' | 'action'>;

function documentId(value: unknown): string {
	const id = field(value, '_id');
	if (typeof id !== 'string') throw new Error('the component returned no document id');
	return id;
}

async function createUser(t: Harness, role?: string): Promise<string> {
	const now = Date.now();
	return documentId(
		await t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'user',
				data: {
					name: 'Golden User',
					email: 'golden@example.test',
					emailVerified: true,
					createdAt: now,
					updatedAt: now,
					...(role ? { role } : {})
				}
			}
		})
	);
}

async function signedIn(t: Harness): Promise<Caller> {
	const userId = await createUser(t);
	const now = Date.now();
	const sessionId = documentId(
		await t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'session',
				data: {
					userId,
					token: 'golden-session-token',
					expiresAt: now + 60_000,
					createdAt: now,
					updatedAt: now
				}
			}
		})
	);
	return t.withIdentity({ subject: userId, sessionId });
}

function call(caller: Caller, kind: Kind, path: string, args: Record<string, unknown>) {
	switch (kind) {
		case 'query':
			return caller.query(makeFunctionReference<'query', Record<string, unknown>>(path), args);
		case 'mutation':
			return caller.mutation(
				makeFunctionReference<'mutation', Record<string, unknown>>(path),
				args
			);
		case 'action':
			return caller.action(makeFunctionReference<'action', Record<string, unknown>>(path), args);
	}
}

function returnProbe(published: Published, value: unknown) {
	return Object.assign(Object.create(published.registered), { _handler: async () => value });
}

async function triggerReferences() {
	const { configs } = await authClients;
	expect(configs).toHaveLength(1);
	const [config] = configs;
	if (!config || !('authFunctions' in config)) {
		throw new Error('the Better Auth client got no trigger functions');
	}
	const { onCreate, onUpdate, onDelete } = config.authFunctions;
	if (!onCreate || !onUpdate || !onDelete) throw new Error('a Better Auth trigger is missing');
	return { onCreate, onUpdate, onDelete };
}

function counters(t: Harness) {
	return t.run((ctx) => getCounters(ctx));
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal('fetch', async () => {
		throw new Error('network access is disabled in the Convex goldens');
	});
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('Convex runtime goldens', () => {
	it('keep what every public function answers to a minimal and an invalid call', async () => {
		const outcomes: Record<string, Record<string, string>> = {};
		for (const published of (await publishedFunctions()).filter(
			({ visibility }) => visibility === 'public'
		)) {
			const args = minimalArgs(published.args);
			const anonymous = harness();
			const user = harness();
			outcomes[published.path] = {
				anonymous: await settle(() => call(anonymous, published.kind, published.path, args)),
				user: await settle(async () =>
					call(await signedIn(user), published.kind, published.path, args)
				),
				invalidArgs: await settle(() =>
					call(harness(), published.kind, published.path, {
						...args,
						goldenUnexpectedField: true
					})
				)
			};
		}

		await expect(await goldenText(outcomes)).toMatchFileSnapshot(golden('handler-outcomes.json'));
	}, 300_000);

	it('validate the published return value of one function per kind', async () => {
		const published = await publishedFunctions();
		const probes: Record<string, Record<string, string>> = {};
		for (const kind of ['query', 'mutation', 'action'] as const) {
			const subject = published.find(
				(candidate) =>
					candidate.kind === kind &&
					candidate.visibility === 'public' &&
					field(candidate.returns, 'type') === 'object'
			);
			if (!subject) throw new Error(`no public ${kind} returns an object`);
			const [, name = ''] = subject.path.split(':');
			const outcome = async (value: unknown) => {
				const t = harness({
					[`${NATIVE}${PROBE_MODULE}.ts`]: async () => ({ [name]: returnProbe(subject, value) })
				});
				return settle(() => call(t, kind, `${PROBE_MODULE}:${name}`, minimalArgs(subject.args)));
			};
			probes[kind] = {
				function: subject.path,
				valid: await outcome(minimalValue(subject.returns)),
				invalid: await outcome({ goldenUnexpectedField: true })
			};
		}

		expect(Object.values(probes).map(({ valid }) => valid)).toEqual(['ok', 'ok', 'ok']);
		await expect(await goldenText(probes)).toMatchFileSnapshot(golden('return-validators.json'));
	}, 60_000);

	it('hand the components published callback paths that run', async () => {
		const triggers = await triggerReferences();
		const onEmailEvent = resend.onEmailEvent;
		if (!onEmailEvent) throw new Error('the Resend client got no event callback');
		const published = new Map((await publishedFunctions()).map((entry) => [entry.path, entry]));
		const registration = (reference: FunctionReference<'mutation', FunctionVisibility>) => {
			const path = getFunctionName(reference);
			const entry = published.get(path);
			return entry ? `${path} ${entry.visibility} ${entry.kind}` : `${path} unpublished`;
		};
		await expect(
			await goldenText({
				betterAuth: {
					onCreate: registration(triggers.onCreate),
					onUpdate: registration(triggers.onUpdate),
					onDelete: registration(triggers.onDelete)
				},
				resend: { onEmailEvent: registration(onEmailEvent) }
			})
		).toMatchFileSnapshot(golden('component-callbacks.json'));

		const t = harness();
		const [onCreateHandle, onUpdateHandle, onDeleteHandle] = await t.run(() =>
			Promise.all([
				createFunctionHandle(triggers.onCreate),
				createFunctionHandle(triggers.onUpdate),
				createFunctionHandle(triggers.onDelete)
			])
		);
		const now = Date.now();
		const userId = documentId(
			await t.mutation(components.betterAuth.adapter.create, {
				input: {
					model: 'user',
					data: {
						name: 'Golden Trigger',
						email: 'trigger@example.test',
						emailVerified: true,
						createdAt: now,
						updatedAt: now
					}
				},
				onCreateHandle
			})
		);
		expect(await counters(t)).toMatchObject({ totalUsers: 1, adminCount: 0 });

		await t.mutation(components.betterAuth.adapter.updateOne, {
			input: { model: 'user', update: { role: 'admin' }, where: [{ field: '_id', value: userId }] },
			onUpdateHandle
		});
		expect(await counters(t)).toMatchObject({ totalUsers: 1, adminCount: 1 });

		await t.mutation(components.betterAuth.adapter.deleteOne, {
			input: { model: 'user', where: [{ field: '_id', value: userId }] },
			onDeleteHandle
		});
		expect(await counters(t)).toMatchObject({ totalUsers: 0, adminCount: 0 });

		const eventPath = getFunctionName(onEmailEvent);
		const onEmailEventHandle = await t.run(() =>
			createFunctionHandle(makeFunctionReference<'mutation', Record<string, unknown>>(eventPath))
		);
		const eventArgs = minimalArgs(published.get(eventPath)?.args);
		expect(await settle(() => t.run((ctx) => ctx.runMutation(onEmailEventHandle, eventArgs)))).toBe(
			'ok'
		);
	}, 60_000);
});
