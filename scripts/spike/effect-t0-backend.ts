/**
 * T0 spike runner against the local Convex backend that `bun run dev:test`
 * starts. Reads the backend URL and admin key from `.convex/`, runs the item
 * 1 to 4 probes and the p50 baselines, and prints one JSON report.
 *
 *   bun scripts/spike/effect-t0-backend.ts [--runs 100]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';

const api = anyApi;
const internal = anyApi;
const root = process.cwd();
const runs = Number(process.argv[process.argv.indexOf('--runs') + 1]) || 100;
const only = process.argv.includes('--only')
	? process.argv[process.argv.indexOf('--only') + 1]
	: '';

const url = fs.readFileSync(path.join(root, '.convex', '.test-backend-url'), 'utf8').trim();
const stateDir = fs
	.readdirSync(path.join(root, '.convex'))
	.map((name) => path.join(root, '.convex', name))
	.find((dir) => dir.includes('-e2e-') && fs.existsSync(path.join(dir, 'keys.json')));
if (!stateDir) throw new Error('no e2e backend state with keys.json under .convex/');
const { adminKey } = JSON.parse(fs.readFileSync(path.join(stateDir, 'keys.json'), 'utf8')) as {
	adminKey: string;
};

type AdminClient = ConvexHttpClient & {
	setAdminAuth(token: string, identity?: Record<string, string>): void;
};
const client = (user?: { userId: string; sessionId: string }) => {
	const c = new ConvexHttpClient(url) as AdminClient;
	c.setAdminAuth(
		adminKey,
		user && { subject: user.userId, sessionId: user.sessionId, issuer: 'effect-t0-spike' }
	);
	return c;
};
const admin = client();

async function outcome(promise: Promise<unknown>) {
	try {
		return { ok: true, value: await promise };
	} catch (error) {
		const e = error as { message?: string; data?: unknown; name?: string };
		return { ok: false, name: e.name, data: e.data ?? null, message: e.message?.slice(0, 400) };
	}
}

const stamp = Date.now();
const seedUser = (name: string, role?: string) =>
	admin.mutation(api.effectSpike.seed.seedSpikeUser, {
		name,
		email: `${name}-${stamp}@spike.test`,
		role
	}) as Promise<{ userId: string; sessionId: string }>;

function p50(samples: number[]) {
	const sorted = [...samples].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
const summary = (samples: number[]) => ({
	runs: samples.length,
	p50Ms: Number(p50(samples).toFixed(3)),
	minMs: Number(Math.min(...samples).toFixed(3)),
	maxMs: Number(Math.max(...samples).toFixed(3))
});

/** Interleaves plain and Effect calls so drift hits both equally. */
async function matched(
	label: string,
	prepare: (i: number) => Promise<void>,
	plain: (i: number) => Promise<unknown>,
	effect: (i: number) => Promise<unknown>
) {
	const time = async (fn: (i: number) => Promise<unknown>, i: number) => {
		await prepare(i);
		const start = performance.now();
		await fn(i);
		return performance.now() - start;
	};
	for (let i = 0; i < 10; i++) {
		await time(plain, i);
		await time(effect, i);
	}
	const plainSamples: number[] = [];
	const effectSamples: number[] = [];
	for (let i = 0; i < runs; i++) {
		if (i % 2 === 0) {
			plainSamples.push(await time(plain, i));
			effectSamples.push(await time(effect, i));
		} else {
			effectSamples.push(await time(effect, i));
			plainSamples.push(await time(plain, i));
		}
	}
	const plainSummary = summary(plainSamples);
	const effectSummary = summary(effectSamples);
	return {
		label,
		plain: plainSummary,
		effect: effectSummary,
		deltaPct: Number(((effectSummary.p50Ms / plainSummary.p50Ms - 1) * 100).toFixed(1)),
		pairedRatioP50: Number(
			p50(effectSamples.map((sample, i) => sample / plainSamples[i]!)).toFixed(3)
		)
	};
}

const report: Record<string, unknown> = {
	url,
	runs,
	loadAverageAtStart: os.loadavg(),
	startedAt: new Date().toISOString()
};

const adminUser = await seedUser('admin', 'admin');
const plainUser = await seedUser('user');
const asAdmin = client(adminUser);
const asUser = client(plainUser);

if (!only || only === 'items') {
	await admin.mutation(api.effectSpike.seed.setDismissal, {
		userId: plainUser.userId,
		deferredUntil: 1234
	});
	const targetPlain = await seedUser('target-plain');
	const targetEffect = await seedUser('target-effect');
	await admin.mutation(api.effectSpike.seed.seedAiChatThread, { userId: plainUser.userId });
	report.item1 = {
		authedQuery: {
			plain: await outcome(asUser.query(api.users.getPasskeyNudgeDismissal, {})),
			effect: await outcome(asUser.query(api.effectSpike.users.passkeyNudgeDismissal, {}))
		},
		adminMutation: {
			plain: await outcome(
				asAdmin.mutation(api.admin.mutations.setUserRole, {
					userId: targetPlain.userId,
					role: 'admin'
				})
			),
			effect: await outcome(
				asAdmin.mutation(api.effectSpike.adminMutations.setUserRole, {
					userId: targetEffect.userId,
					role: 'admin'
				})
			)
		},
		internalMutation: {
			plain: await outcome(admin.mutation(api.aiChat.activityMigration.start, { restart: true })),
			plainStatus: await outcome(admin.query(api.aiChat.activityMigration.status, {})),
			plainScheduledLater: await new Promise((resolve) => setTimeout(resolve, 1500)).then(() =>
				outcome(admin.query(api.aiChat.activityMigration.status, {}))
			),
			effect: await outcome(
				admin.mutation(api.effectSpike.activityMigration.startActivityMigration, { restart: true })
			),
			effectStatus: await outcome(admin.query(api.aiChat.activityMigration.status, {})),
			effectScheduledLater: await new Promise((resolve) => setTimeout(resolve, 1500)).then(() =>
				outcome(admin.query(api.aiChat.activityMigration.status, {}))
			)
		}
	};

	await admin.mutation(api.effectSpike.seed.seedMessages, { count: 500, userId: plainUser.userId });
	report.item2 = {
		stressQuery: await outcome(admin.query(internal.effectSpike.probes.stressQuery, {})),
		stressMutation: await outcome(admin.mutation(internal.effectSpike.probes.stressMutation, {})),
		read500Succeed: await outcome(
			admin.query(internal.effectSpike.probes.readStressQuery, { limit: 500, perDoc: 'succeed' })
		),
		read500Traced: await outcome(
			admin.query(internal.effectSpike.probes.readStressQuery, { limit: 500, perDoc: 'traced' })
		),
		controlQuery: await outcome(
			admin.query(internal.effectSpike.probes.stressQueryDefaultScheduler, {})
		),
		controlMutation: await outcome(
			admin.mutation(internal.effectSpike.probes.stressMutationDefaultScheduler, {})
		),
		controlRead500Succeed: await outcome(
			admin.query(internal.effectSpike.probes.readStressQueryDefaultScheduler, {
				limit: 500,
				perDoc: 'succeed'
			})
		),
		controlRead500Traced: await outcome(
			admin.query(internal.effectSpike.probes.readStressQueryDefaultScheduler, {
				limit: 500,
				perDoc: 'traced'
			})
		)
	};

	report.item3 = {
		declaredPlain: await outcome(
			asAdmin.mutation(api.admin.mutations.setUserRole, { userId: adminUser.userId, role: 'user' })
		),
		declaredEffect: await outcome(
			asAdmin.mutation(api.effectSpike.adminMutations.setUserRole, {
				userId: adminUser.userId,
				role: 'user'
			})
		),
		passthrough: await outcome(
			admin.query(internal.effectSpike.probes.passthroughQuery, { userId: 'u_9' })
		),
		unauthenticatedPlain: await outcome(admin.query(api.users.getPasskeyNudgeDismissal, {})),
		unauthenticatedEffect: await outcome(
			admin.query(api.effectSpike.users.passkeyNudgeDismissal, {})
		),
		notAdminPlain: await outcome(
			asUser.mutation(api.admin.mutations.setUserRole, { userId: plainUser.userId, role: 'admin' })
		),
		notAdminEffect: await outcome(
			asUser.mutation(api.effectSpike.adminMutations.setUserRole, {
				userId: plainUser.userId,
				role: 'admin'
			})
		),
		defect: await outcome(admin.query(internal.effectSpike.probes.defectQuery, {}))
	};

	report.item4 = {
		ambient: await outcome(
			admin.query(internal.effectSpike.probes.clockProbeQuery, { explicit: false, live: false })
		),
		explicit: await outcome(
			admin.query(internal.effectSpike.probes.clockProbeQuery, { explicit: true, live: false })
		),
		liveControl: await outcome(
			admin.query(internal.effectSpike.probes.clockProbeQuery, { explicit: false, live: true })
		)
	};

	const siteUrl = url.replace(/:(\d+)$/, (_, port: string) => `:${Number(port) + 1}`);
	const echo = async (mode: string) => {
		const response = await fetch(`${siteUrl}/effect-spike/echo?mode=${mode}`);
		return { status: response.status, body: (await response.text()).slice(0, 200) };
	};
	report.http = {
		siteUrl,
		ok: await echo('ok'),
		refuse: await echo('refuse'),
		defect: await echo('defect')
	};
}

if (!only || only === 'p50') {
	const target = await seedUser('p50-target');
	let deferredUntil = 0;
	const touch = () =>
		admin.mutation(api.effectSpike.seed.setDismissal, {
			userId: plainUser.userId,
			deferredUntil: ++deferredUntil
		}) as Promise<unknown>;
	const emailIds = (await admin.mutation(api.effectSpike.seed.seedResendEmails, {
		count: 3
	})) as string[];
	const roleFor = (i: number) => (i % 2 === 0 ? 'admin' : 'user');

	const waitComplete = async () => {
		for (let i = 0; i < 200; i++) {
			const status = (await admin.query(api.aiChat.activityMigration.status, {})) as {
				status: string;
			} | null;
			if (status?.status === 'complete') return;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error('activity migration did not complete');
	};

	report.p50 = [
		await matched(
			'authedQuery getPasskeyNudgeDismissal (cache invalidated before each call)',
			async () => {
				await touch();
			},
			() => asUser.query(api.users.getPasskeyNudgeDismissal, {}),
			() => asUser.query(api.effectSpike.users.passkeyNudgeDismissal, {})
		),
		await matched(
			'adminMutation setUserRole (role alternates admin/user)',
			async () => {},
			(i) =>
				asAdmin.mutation(api.admin.mutations.setUserRole, {
					userId: target.userId,
					role: roleFor(i)
				}),
			(i) =>
				asAdmin.mutation(api.effectSpike.adminMutations.setUserRole, {
					userId: target.userId,
					role: roleFor(i + 1)
				})
		),
		await matched(
			'internalMutation activityMigration.start restart=true (schedules runPage)',
			waitComplete,
			() => admin.mutation(api.aiChat.activityMigration.start, { restart: true }),
			() =>
				admin.mutation(api.effectSpike.activityMigration.startActivityMigration, { restart: true })
		),
		await matched(
			'internalMutation customerNotifications cancelUnsentEmails (3 sent emails)',
			async () => {},
			() =>
				admin.mutation(api.admin.customerNotifications.cancel.cancelUnsentEmails, {
					emailIds
				}),
			() => admin.mutation(api.effectSpike.cancel.cancelUnsentEmails, { emailIds })
		)
	];
}

report.loadAverageAtEnd = os.loadavg();
report.finishedAt = new Date().toISOString();
console.log(JSON.stringify(report, null, 2));
