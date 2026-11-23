import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type { MutationCtx as ConvexMutationCtx } from '../../../convex/_generated/server';
import databaseSchema from '../../_generated/schema';
import { MutationCtx } from '../../_generated/services';
import { FounderWelcomeRefusal } from '../../errorCodecs';
import RequireAdminImpl from '../../middleware/RequireAdmin.impl';
import { CurrentUser } from '../../middleware/RequireUser.spec';
import { FOUNDER_WELCOME_ERROR_CODES, type FounderWelcomeErrorCode } from './errors';
import {
	clearContact,
	readContactUserId,
	saveFounderEmailTemplate,
	saveFounderWelcomeConfig,
	switchFounderEmail
} from './mutations';
import mutations from './mutations.spec';

const withCtx = <A>(run: (ctx: ConvexMutationCtx) => Promise<A>) =>
	MutationCtx.use((ctx) => Effect.promise(() => run(ctx)));

const refuse = (code: FounderWelcomeErrorCode) => Effect.fail(new FounderWelcomeRefusal({ code }));

const contactPerson = Effect.gen(function* () {
	const admin = yield* CurrentUser;
	if ((yield* withCtx(readContactUserId)) !== admin._id) {
		return yield* refuse(FOUNDER_WELCOME_ERROR_CODES.notCurrentContact);
	}
	return admin;
});

export default GroupImpl.make(databaseSchema, mutations).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, mutations, 'setFounderEmailEnabled', ({ email, enabled }) =>
			Effect.gen(function* () {
				const admin = yield* contactPerson;
				yield* withCtx((ctx) => switchFounderEmail(ctx, admin._id, email, enabled));
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, mutations, 'stepDown', () =>
			Effect.gen(function* () {
				yield* contactPerson;
				yield* withCtx(clearContact);
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, mutations, 'updateConfig', (args) =>
			Effect.gen(function* () {
				const admin = yield* CurrentUser;
				const name = args.name.trim().replace(/[\r\n<>]/g, '');
				const title = args.title.trim();
				const subject = args.subject.trim();
				const body = args.body.trim();
				const replyTo = args.replyTo?.trim() || undefined;

				if (!name) return yield* refuse(FOUNDER_WELCOME_ERROR_CODES.nameRequired);
				if (!title) return yield* refuse(FOUNDER_WELCOME_ERROR_CODES.titleRequired);
				if (!subject) return yield* refuse(FOUNDER_WELCOME_ERROR_CODES.subjectRequired);
				if (!body) return yield* refuse(FOUNDER_WELCOME_ERROR_CODES.bodyRequired);
				if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) {
					return yield* refuse(FOUNDER_WELCOME_ERROR_CODES.replyToInvalid);
				}

				yield* withCtx((ctx) =>
					saveFounderWelcomeConfig(ctx, admin._id, { name, title, subject, body, replyTo })
				);
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, mutations, 'updateFounderEmailTemplate', (args) =>
			Effect.gen(function* () {
				const admin = yield* contactPerson;
				const subject = args.subject.trim();
				const body = args.body.trim();
				if (!subject) return yield* refuse(FOUNDER_WELCOME_ERROR_CODES.subjectRequired);
				if (!body) return yield* refuse(FOUNDER_WELCOME_ERROR_CODES.bodyRequired);

				yield* withCtx((ctx) =>
					saveFounderEmailTemplate(ctx, admin._id, args.email, { subject, body })
				);
				return null;
			})
		)
	]),
	Layer.provide(RequireAdminImpl),
	GroupImpl.finalize
);
