// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, components, internal } from '../../../convex/_generated/api';
import schema from '../../../convex/schema';
import authSchema from '../../../convex-components/betterAuth/schema';
import { preloadComponent } from '../../convexComponents.fixtures';
import { convexModules, preloadModules } from '../../convexTest.modules';

const betterAuthModules = await preloadModules(
	import.meta.glob('../../../convex-components/betterAuth/**/*.ts')
);
const agentComponent = await preloadComponent.agent();
const rateLimiterComponent = await preloadComponent.rateLimiter();

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	agentComponent.register(t);
	rateLimiterComponent.register(t);
	return t;
};
type Harness = ReturnType<typeof harness>;

const warmThread = async (t: Harness, anonymousUserId: string) =>
	(await t.mutation(api.support.threads.getOrCreateWarmThread, { anonymousUserId })).threadId;

const handedOff = async (t: Harness) =>
	Object.fromEntries(
		(await t.run((ctx) => ctx.db.query('supportThreads').take(100))).map((row) => [
			row.threadId,
			row.isHandedOff === true
		])
	);

const notifications = async (t: Harness) =>
	(await t.run((ctx) => ctx.db.system.query('_scheduled_functions').take(100)))
		.filter((job) => job.name === 'admin/support/notifications:scheduleAdminNotification')
		.map((job) => job.args[0]);

const assistantTexts = async (t: Harness, threadId: string) =>
	(
		await t.query(components.agent.messages.listMessagesByThreadId, {
			threadId,
			order: 'asc',
			paginationOpts: { numItems: 10, cursor: null }
		})
	).page
		.filter((message) => message.message?.role === 'assistant')
		.map((message) => message.text);

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('internalSetHandoff', () => {
	it('hands the named thread to the team and announces it once', async () => {
		const t = harness();
		const threadId = await warmThread(t, 'anon_owner');
		const otherThreadId = await warmThread(t, 'anon_other');

		await t.mutation(internal.support.handoff.internalSetHandoff, { threadId });
		await t.mutation(internal.support.handoff.internalSetHandoff, { threadId });

		expect(await handedOff(t)).toEqual({ [threadId]: true, [otherThreadId]: false });
		expect(await notifications(t)).toEqual([
			{ threadId, messageIds: [], isReopen: false, notificationType: 'newTickets' }
		]);
		expect(await assistantTexts(t, threadId)).toEqual([]);
	});

	it('announces the handoff for immediate delivery', async () => {
		const t = harness();
		const threadId = await warmThread(t, 'anon_owner');
		const now = Date.now();

		await t.mutation(internal.support.handoff.internalSetHandoff, { threadId });

		const jobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').take(100));
		expect(
			jobs
				.filter((job) => job.name === 'admin/support/notifications:scheduleAdminNotification')
				.map((job) => job.scheduledTime)
		).toEqual([now]);
	});

	it('acknowledges the visitor when asked', async () => {
		const t = harness();
		const threadId = await warmThread(t, 'anon_owner');

		await t.mutation(internal.support.handoff.internalSetHandoff, {
			threadId,
			acknowledge: true
		});

		expect(await assistantTexts(t, threadId)).toHaveLength(1);
	});

	it('changes nothing for an unknown thread', async () => {
		const t = harness();
		const threadId = await warmThread(t, 'anon_owner');

		await expect(
			t.mutation(internal.support.handoff.internalSetHandoff, { threadId: 'thread_missing' })
		).resolves.toBeNull();

		expect(await handedOff(t)).toEqual({ [threadId]: false });
		expect(await notifications(t)).toEqual([]);
	});
});
