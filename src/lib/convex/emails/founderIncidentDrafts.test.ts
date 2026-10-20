// @vitest-environment node
/// <reference types="vite/client" />
import type {
	DataModelFromSchemaDefinition,
	GenericMutationCtx,
	GenericSchema,
	SchemaDefinition
} from 'convex/server';
import { convexTest } from 'convex-test';
import resendSchema from '../../../../node_modules/@convex-dev/resend/dist/component/schema.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { internal } from '../_generated/api';
import authSchema from '../betterAuth/schema';
import { SUPPORTED_LOCALES } from '../i18n/translations';
import schema from '../schema';
import { founderIncidentRegistry } from './founderIncidentRegistry';
import type { FounderIncidentRenderer, FounderIncidentTemplate } from './founderIncidentTypes';

vi.mock('@gilhrpenner/convex-files-control', () => ({ registerRoutes: () => {} }));

const network = vi.fn<typeof fetch>();
const incident = 'service-restored';
const templates = [
	{
		locale: 'en',
		subject: ' Restored for {{userFirstName}} ',
		text: ' Hello {{userFirstName}},\n{{founderName}} '
	}
];
const draftApi = internal.emails.founderIncidentDrafts;
const modules = Object.fromEntries(
	Object.entries(import.meta.glob('../**/*.ts')).map(([path, loader]) => [
		path.startsWith('../') ? path.replace(/^\.\.\//u, './') : path.replace(/^\.\//u, './emails/'),
		loader
	])
);
const authModules = import.meta.glob('../betterAuth/**/*.ts');
const resendModules = import.meta.glob(
	'../../../../node_modules/@convex-dev/resend/dist/component/**/*.js'
);

function createHarness() {
	const t = convexTest(schema, modules);
	t.registerComponent('betterAuth', authSchema, authModules);
	t.registerComponent('resend', resendSchema, resendModules);
	// Enqueue schedules Resend's batch mutation; delivery workers are not executed here.
	return t;
}

type Harness = ReturnType<typeof createHarness>;

/** convex-test exposes component database access at runtime, without a public type. */
function inComponent<S extends SchemaDefinition<GenericSchema, boolean>, T>(
	t: Harness,
	name: string,
	_schema: S,
	run: (ctx: GenericMutationCtx<DataModelFromSchemaDefinition<S>>) => Promise<T>
): Promise<T> {
	const withComponent = t as Harness & {
		runInComponent: (component: string, handler: typeof run) => Promise<T>;
	};
	return withComponent.runInComponent(name, run);
}

beforeEach(() => {
	// Block transport before registering components or allowing scheduler work.
	network.mockReset();
	network.mockRejectedValue(new Error('External transport forbidden in incident tests'));
	vi.stubGlobal('fetch', network);
	vi.useFakeTimers();
	vi.stubEnv('RESEND_API_KEY', 're_test');
	vi.stubEnv('AUTH_EMAIL', 'founder@example.com');
	vi.stubEnv('EMAIL_ASSET_URL', 'https://assets.example.com');
});

afterEach(() => {
	try {
		expect(network).not.toHaveBeenCalled();
	} finally {
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	}
});

async function setup(locale: string | null = 'en') {
	const t = createHarness();
	const { userId, founderId } = await inComponent(t, 'betterAuth', authSchema, async (ctx) => {
		const userId = await ctx.db.insert('user', {
			name: 'Grace Hopper',
			email: 'recipient@example.com',
			emailVerified: true,
			locale,
			createdAt: 1,
			updatedAt: 1
		});
		const founderId = await ctx.db.insert('user', {
			name: 'Ada',
			email: 'ada@example.com',
			emailVerified: true,
			role: 'admin',
			createdAt: 1,
			updatedAt: 1
		});
		return { userId, founderId };
	});
	const contactSetting = await t.run((ctx) =>
		ctx.db.insert('adminSettings', {
			key: 'founderWelcome.contactUserId',
			value: founderId,
			updatedAt: 1,
			updatedBy: founderId
		})
	);
	const save = (
		copy: FounderIncidentTemplate[] = templates,
		expectedRevision: number | null = null,
		key = incident
	) => t.mutation(draftApi.saveDraft, { incident: key, expectedRevision, templates: copy });
	const preview = () => t.query(draftApi.previewDraft, { incident, userId });
	const ready = async () => {
		const result = await preview();
		if (result.status !== 'ready') throw new Error('Expected eligible preview');
		return result;
	};
	const queue = (approvalDigest: string) =>
		t.mutation(draftApi.queueDraft, { incident, userId, approvalDigest });
	return { t, userId, founderId, contactSetting, save, preview, ready, queue };
}

async function rows(t: Harness) {
	const app = await t.run(async (ctx) => ({
		ledger: await ctx.db.query('founderIncidentEmails').take(20),
		drafts: await ctx.db.query('founderIncidentDrafts').take(20),
		scheduled: await ctx.db.system.query('_scheduled_functions').take(20)
	}));
	const component = await inComponent(t, 'resend', resendSchema, async (ctx) => ({
		emails: await ctx.db.query('emails').take(20),
		content: await ctx.db.query('content').take(20),
		scheduled: await ctx.db.system.query('_scheduled_functions').take(20),
		batch: await ctx.db.query('nextBatchRun').take(20),
		options: await ctx.db.query('lastOptions').take(20)
	}));
	return { app, component };
}

async function expectNoEnqueue(t: Harness) {
	const state = await rows(t);
	expect(state.app.ledger).toEqual([]);
	expect(state.app.scheduled).toEqual([]);
	expect(state.component).toEqual({
		emails: [],
		content: [],
		scheduled: [],
		batch: [],
		options: []
	});
}

describe('founder incident drafts with real components', () => {
	it('creates, edits with CAS, and preserves timestamps on identical retries', async () => {
		const h = await setup();
		expect(await h.save()).toEqual({ revision: 1 });
		const original = (await rows(h.t)).app.drafts;
		vi.advanceTimersByTime(100);
		expect(await h.save()).toEqual({ revision: 1 });
		expect((await rows(h.t)).app.drafts).toEqual(original);
		const changed = [{ ...templates[0]!, text: 'Updated {{founderName}}' }];
		expect(await h.save(changed, 1)).toEqual({ revision: 2 });
		expect(await h.save(changed, 1)).toEqual({ revision: 2 });
		await expect(h.save(templates, 1)).rejects.toThrow('revision conflict');
		await expect(h.save(templates, 3)).rejects.toThrow('revision conflict');
		await expect(h.save(templates, 0.5)).rejects.toThrow('expected revision');
		await expect(h.save(templates, 1, 'absent')).rejects.toThrow('revision conflict');
	});

	it('rejects invalid saved content without replacing a usable revision', async () => {
		const h = await setup();
		await h.save();
		const before = await rows(h.t);
		await expect(h.save([{ ...templates[0]!, text: '{{unknown}}' }], 1)).rejects.toThrow(
			'placeholders'
		);
		expect(await rows(h.t)).toEqual(before);
	});

	it('treats reordered locales as an identical retry', async () => {
		const h = await setup();
		const copy = SUPPORTED_LOCALES.map((locale) => ({ ...templates[0]!, locale }));
		await h.save(copy);
		const before = await rows(h.t);
		expect(await h.save(copy.reverse())).toEqual({ revision: 1 });
		expect(await rows(h.t)).toEqual(before);
	});

	it('previews without writes and queues exact normalized content without a registry entry', async () => {
		const h = await setup();
		await h.save();
		const before = await rows(h.t);
		const preview = await h.ready();
		expect(preview).toMatchObject({
			revision: 1,
			locale: 'en',
			envelope: {
				from: 'Ada <founder@example.com>',
				to: 'recipient@example.com',
				replyTo: ['ada@example.com'],
				subject: 'Restored for Grace',
				text: 'Hello Grace,\nAda'
			}
		});
		expect(await rows(h.t)).toEqual(before);
		await expect(
			h.t.mutation(internal.emails.founderIncidentSend.queueFounderIncidentEmail, {
				incident,
				userId: h.userId
			})
		).rejects.toThrow('Unknown founder incident key');
		expect(await h.queue(preview.approvalDigest)).toEqual({ status: 'enqueued' });
		const after = await rows(h.t);
		expect(after.app.ledger).toHaveLength(1);
		expect(after.component.emails).toHaveLength(1);
		expect(after.component.content).toHaveLength(1);
		expect(after.component.scheduled.length).toBeGreaterThan(0);
		const email = after.component.emails[0]!;
		expect(email).toMatchObject({
			...preview.envelope,
			to: [preview.envelope.to],
			text: after.component.content[0]!._id
		});
		expect(new TextDecoder().decode(after.component.content[0]!.content)).toBe(
			preview.envelope.text
		);
		expect(email.html).toBeUndefined();
	});

	it.each(SUPPORTED_LOCALES)(
		'uses an explicit %s template without requiring English',
		async (locale) => {
			const h = await setup(locale);
			await h.save([
				{ locale, subject: `Restored (${locale})`, text: '{{userFirstName}} / {{founderName}}' }
			]);
			const preview = await h.ready();
			expect(preview.locale).toBe(locale);
			expect(preview.envelope.subject).toBe(`Restored (${locale})`);
			expect(await h.queue(preview.approvalDigest)).toEqual({ status: 'enqueued' });
		}
	);

	it.each(['de', 'es', 'fr'])(
		'does not silently use English for missing %s copy',
		async (locale) => {
			const h = await setup(locale);
			await h.save();
			await expect(h.preview()).rejects.toThrow('recipient locale');
			await expect(h.queue('unapproved')).rejects.toThrow('recipient locale');
			await expectNoEnqueue(h.t);
			expect(await h.save([{ locale, subject: 'Restored', text: 'Updated' }], 1)).toEqual({
				revision: 2
			});
		}
	);

	it.each([null, 'xx'])(
		'uses the existing default for missing or unsupported locale %s',
		async (locale) => {
			const h = await setup(locale);
			await h.save([{ locale: 'de', subject: 'Restored', text: 'Updated' }]);
			await expect(h.preview()).rejects.toThrow('recipient locale');
			await h.save(templates, 1);
			expect((await h.ready()).locale).toBe('en');
		}
	);

	it('rejects an unapproved digest without freezing or consuming the incident', async () => {
		const h = await setup();
		await h.save();
		await expect(h.queue('not-approved')).rejects.toThrow('approval no longer matches');
		await expectNoEnqueue(h.t);
		expect(await h.save([{ ...templates[0]!, text: 'Revised' }], 1)).toEqual({ revision: 2 });
	});

	it('rejects an old digest when save wins before queue', async () => {
		const h = await setup();
		await h.save();
		const preview = await h.ready();
		await h.save([{ ...templates[0]!, text: 'Revised' }], 1);
		await expect(h.queue(preview.approvalDigest)).rejects.toThrow('approval no longer matches');
		await expectNoEnqueue(h.t);
		expect(await h.queue((await h.ready()).approvalDigest)).toEqual({ status: 'enqueued' });
	});

	it('freezes edits when queue wins, while allowing identical retries', async () => {
		const h = await setup();
		await h.save();
		await h.queue((await h.ready()).approvalDigest);
		await expect(h.save([{ ...templates[0]!, text: 'Revised' }], 1)).rejects.toThrow('frozen');
		expect(await h.save()).toEqual({ revision: 1 });
	});

	it('dedupes same-key invocations serialized by convex-test, not a hosted OCC race', async () => {
		const h = await setup();
		await h.save();
		const preview = await h.ready();
		expect(
			await Promise.all([h.queue(preview.approvalDigest), h.queue(preview.approvalDigest)])
		).toEqual([{ status: 'enqueued' }, { status: 'already_processed' }]);
		const state = await rows(h.t);
		expect(state.app.ledger).toHaveLength(1);
		expect(state.component.emails).toHaveLength(1);
	});

	it('dedupes per incident and recipient, not across distinct pairs', async () => {
		const h = await setup();
		await h.save();
		await h.queue((await h.ready()).approvalDigest);
		const otherUser = await h.t.query(draftApi.previewDraft, { incident, userId: h.founderId });
		if (otherUser.status !== 'ready') throw new Error('Expected eligible administrator');
		expect(
			await h.t.mutation(draftApi.queueDraft, {
				incident,
				userId: h.founderId,
				approvalDigest: otherUser.approvalDigest
			})
		).toEqual({ status: 'enqueued' });
		await h.save(templates, null, 'another-incident');
		const otherIncident = await h.t.query(draftApi.previewDraft, {
			incident: 'another-incident',
			userId: h.userId
		});
		if (otherIncident.status !== 'ready') throw new Error('Expected eligible preview');
		expect(
			await h.t.mutation(draftApi.queueDraft, {
				incident: 'another-incident',
				userId: h.userId,
				approvalDigest: otherIncident.approvalDigest
			})
		).toEqual({ status: 'enqueued' });
		const state = await rows(h.t);
		expect(state.app.ledger).toHaveLength(3);
		expect(state.component.emails).toHaveLength(3);
	});

	it.each(['email', 'name', 'locale', 'founderName', 'replyTo', 'from'] as const)(
		'rejects stale approval after the rendered %s changes',
		async (field) => {
			const h = await setup();
			await h.save([...templates, { ...templates[0]!, locale: 'de' }]);
			const preview = await h.ready();
			if (field === 'from') vi.stubEnv('AUTH_EMAIL', 'different@example.com');
			else
				await inComponent(h.t, 'betterAuth', authSchema, async (ctx) => {
					if (field === 'founderName')
						await ctx.db.patch('user', h.founderId, { name: 'Different' });
					else if (field === 'replyTo')
						await ctx.db.patch('user', h.founderId, { email: 'reply@example.com' });
					else
						await ctx.db.patch(
							'user',
							h.userId,
							field === 'email'
								? { email: 'changed@example.com' }
								: field === 'name'
									? { name: 'Changed Hopper' }
									: { locale: 'de' }
						);
				});
			await expect(h.queue(preview.approvalDigest)).rejects.toThrow('approval no longer matches');
			await expectNoEnqueue(h.t);
		}
	);

	it('does not invalidate approval for an unused surname change', async () => {
		const h = await setup();
		await h.save();
		const preview = await h.ready();
		await inComponent(h.t, 'betterAuth', authSchema, (ctx) =>
			ctx.db.patch('user', h.userId, { name: 'Grace Changed' })
		);
		expect((await h.ready()).approvalDigest).toBe(preview.approvalDigest);
		expect(await h.queue(preview.approvalDigest)).toEqual({ status: 'enqueued' });
	});

	it.each(['user_deleted', 'not_verified', 'test_email', 'founder_not_configured'] as const)(
		'skips %s after preview without ledger consumption or freeze',
		async (reason) => {
			const h = await setup();
			await h.save();
			const preview = await h.ready();
			if (reason === 'founder_not_configured')
				await h.t.run((ctx) => ctx.db.delete('adminSettings', h.contactSetting));
			else
				await inComponent(h.t, 'betterAuth', authSchema, async (ctx) => {
					if (reason === 'user_deleted') await ctx.db.delete('user', h.userId);
					else
						await ctx.db.patch(
							'user',
							h.userId,
							reason === 'not_verified'
								? { emailVerified: false }
								: { email: 'run@e2e.example.com' }
						);
				});
			expect(await h.preview()).toEqual({ status: 'skipped', reason });
			expect(await h.queue(preview.approvalDigest)).toEqual({ status: 'skipped', reason });
			expect(await h.queue('unapproved')).toEqual({ status: 'skipped', reason });
			await expectNoEnqueue(h.t);
			expect(await h.save([{ ...templates[0]!, text: 'Revised' }], 1)).toEqual({ revision: 2 });
		}
	);

	it('keeps ordinary administrators eligible', async () => {
		const h = await setup();
		await h.save();
		await inComponent(h.t, 'betterAuth', authSchema, (ctx) =>
			ctx.db.patch('user', h.userId, { role: 'admin' })
		);
		expect(await h.queue((await h.ready()).approvalDigest)).toEqual({ status: 'enqueued' });
	});

	it('returns already_processed before reconsidering recipient, contact, or provider configuration', async () => {
		const h = await setup();
		await h.save();
		await h.queue((await h.ready()).approvalDigest);
		await inComponent(h.t, 'betterAuth', authSchema, (ctx) => ctx.db.delete('user', h.userId));
		await h.t.run((ctx) => ctx.db.delete('adminSettings', h.contactSetting));
		vi.stubEnv('RESEND_API_KEY', '');
		expect(await h.queue('different')).toEqual({ status: 'already_processed' });
		expect((await rows(h.t)).component.emails).toHaveLength(1);
	});

	it.each(['RESEND_API_KEY', 'AUTH_EMAIL', 'EMAIL_ASSET_URL'])(
		'does not consume the key when %s is absent',
		async (field) => {
			const h = await setup();
			await h.save();
			const preview = await h.ready();
			vi.stubEnv(field, '');
			await expect(h.preview()).rejects.toThrow('[capability] email');
			await expect(h.queue(preview.approvalDigest)).rejects.toThrow('[capability] email');
			await expectNoEnqueue(h.t);
			expect(await h.save([{ ...templates[0]!, text: 'Revised' }], 1)).toEqual({ revision: 2 });
		}
	);

	it('does not consume or freeze a draft when its rendered content becomes empty', async () => {
		const h = await setup();
		await h.save([{ locale: 'en', subject: 'Restored', text: '{{userFirstName}}' }]);
		const preview = await h.ready();
		await inComponent(h.t, 'betterAuth', authSchema, (ctx) =>
			ctx.db.patch('user', h.userId, { name: ' ' })
		);
		await expect(h.queue(preview.approvalDigest)).rejects.toThrow('email content');
		await expectNoEnqueue(h.t);
		expect(await h.save(templates, 1)).toEqual({ revision: 2 });
	});

	it('rolls back actual component content, email, scheduled work and ledger after an outer mutation throws', async () => {
		const h = await setup();
		await h.save();
		const { approvalDigest } = await h.ready();
		await expect(
			h.t.run(async (ctx) => {
				expect(
					await ctx.runMutation(draftApi.queueDraft, { incident, userId: h.userId, approvalDigest })
				).toEqual({ status: 'enqueued' });
				expect(await ctx.db.query('founderIncidentEmails').take(2)).toHaveLength(1);
				throw new Error('outer_application_failed');
			})
		).rejects.toThrow('outer_application_failed');
		await expectNoEnqueue(h.t);
		expect(await h.save([{ ...templates[0]!, text: 'Revised' }], 1)).toEqual({ revision: 2 });
	});

	it('rejects legacy registry collisions and reserved keys', async () => {
		const h = await setup();
		const registry = founderIncidentRegistry as Record<string, FounderIncidentRenderer>;
		registry['legacy-incident'] = () => ({ subject: 'Legacy', text: 'Legacy' });
		try {
			for (const key of ['legacy-incident', '__test', '', 'invalid key', 'a'.repeat(129)]) {
				await expect(h.save(templates, null, key)).rejects.toThrow('draft key');
			}
		} finally {
			delete registry['legacy-incident'];
		}
		expect((await rows(h.t)).app.drafts).toEqual([]);
	});

	it('freezes on any incident ledger row, including a legacy terminal skip', async () => {
		const h = await setup();
		await h.save();
		await h.t.run((ctx) =>
			ctx.db.insert('founderIncidentEmails', {
				incident,
				userId: h.userId,
				status: 'skipped',
				skippedReason: 'not_verified',
				createdAt: 1
			})
		);
		await expect(h.save([{ ...templates[0]!, text: 'Revised' }], 1)).rejects.toThrow('frozen');
		expect(await h.queue('unapproved')).toEqual({ status: 'already_processed' });
	});
});
