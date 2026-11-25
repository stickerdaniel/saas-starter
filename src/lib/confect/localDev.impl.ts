import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import databaseSchema from './_generated/schema';
import { MutationCtx } from './_generated/services';
import localDev from './localDev.spec';
import { ensureSeededAdmin } from './seededAdmin';

const requiredSeedEnv = (name: string) =>
	Effect.suspend(() => {
		const value = process.env[name]?.trim();
		return value
			? Effect.succeed(value)
			: Effect.die(new Error(`Missing required local seed environment variable: ${name}`));
	});

export default GroupImpl.make(databaseSchema, localDev).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, localDev, 'ensureSeededAdmin', () =>
			Effect.gen(function* () {
				if (process.env.LOCAL_CONVEX_DEV !== 'true') {
					return yield* Effect.die(
						new Error('localDev:ensureSeededAdmin can only run when LOCAL_CONVEX_DEV=true')
					);
				}
				const email = (yield* requiredSeedEnv('LOCAL_SEEDED_ADMIN_EMAIL')).toLowerCase();
				const password = yield* requiredSeedEnv('LOCAL_SEEDED_ADMIN_PASSWORD');
				const name = yield* requiredSeedEnv('LOCAL_SEEDED_ADMIN_NAME');
				return yield* ensureSeededAdmin(yield* MutationCtx, {
					email,
					password,
					name,
					label: 'local seeded admin user'
				});
			})
		)
	]),
	GroupImpl.finalize
);
