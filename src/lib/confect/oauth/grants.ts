import { APIError } from 'better-auth/api';
import type {
	GenericDatabaseReader,
	GenericDatabaseWriter,
	GenericMutationCtx
} from 'convex/server';
import { ConvexError } from 'convex/values';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import { components } from '../../convex/_generated/api';
import type { DataModel } from '../../convex/_generated/dataModel';

const GrantRejection = Schema.Struct({
	code: Schema.Literals([
		'oauth_consent_user_missing',
		'oauth_consent_stale_reference',
		'oauth_refresh_without_grant'
	])
});

type GrantRejectionCode = (typeof GrantRejection.Type)['code'];

const OAUTH_ERRORS = {
	oauth_consent_user_missing: { error: 'invalid_request', error_description: 'user not found' },
	oauth_consent_stale_reference: {
		error: 'invalid_request',
		error_description: 'grant revoked during consent'
	},
	oauth_refresh_without_grant: { error: 'invalid_grant', error_description: 'grant revoked' }
} satisfies Record<GrantRejectionCode, { error: string; error_description: string }>;

const decodeGrantRejection = Schema.decodeUnknownOption(GrantRejection);

const reject = (code: GrantRejectionCode): never => {
	throw new ConvexError({ code });
};

export const asOAuthError = (error: unknown): never => {
	const rejection = error instanceof ConvexError ? decodeGrantRejection(error.data) : Option.none();
	if (Option.isSome(rejection)) {
		throw new APIError('BAD_REQUEST', OAUTH_ERRORS[rejection.value.code]);
	}
	throw error;
};

const epochRow = (db: GenericDatabaseReader<DataModel>, userId: string) =>
	db
		.query('oauthGrantEpochs')
		.withIndex('by_userId', (q) => q.eq('userId', userId))
		.unique();

export const currentEpoch = async (db: GenericDatabaseReader<DataModel>, userId: string) =>
	(await epochRow(db, userId))?.epoch ?? 0;

export const raiseEpoch = async (db: GenericDatabaseWriter<DataModel>, userId: string) => {
	const row = await epochRow(db, userId);
	const epoch = (row?.epoch ?? 0) + 1;
	if (row) await db.patch('oauthGrantEpochs', row._id, { epoch });
	else await db.insert('oauthGrantEpochs', { userId, epoch });
	return epoch;
};

export const deleteEpoch = async (db: GenericDatabaseWriter<DataModel>, userId: string) => {
	const row = await epochRow(db, userId);
	if (row) await db.delete('oauthGrantEpochs', row._id);
};

type GrantRow = {
	clientId: string;
	userId?: string | null;
	referenceId?: string | null;
};

export const assertConsentIsCurrent = async (
	ctx: GenericMutationCtx<DataModel>,
	consent: GrantRow & { _id: string }
) => {
	const userId = consent.userId;
	const user = userId
		? await ctx.runQuery(components.betterAuth.adapter.findOne, {
				model: 'user',
				where: [{ field: '_id', operator: 'eq', value: userId }],
				select: ['_id']
			})
		: null;
	if (!userId || !user) return reject('oauth_consent_user_missing');
	if (consent.referenceId !== String(await currentEpoch(ctx.db, userId))) {
		return reject('oauth_consent_stale_reference');
	}
	await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
		input: {
			model: 'oauthConsent',
			where: [
				{ field: 'clientId', operator: 'eq', value: consent.clientId },
				{ field: 'userId', operator: 'eq', value: userId },
				{ field: '_id', operator: 'ne', value: consent._id }
			]
		},
		paginationOpts: { cursor: null, numItems: 100 }
	});
};

export const assertRefreshHasGrant = async (
	ctx: GenericMutationCtx<DataModel>,
	refreshToken: GrantRow
) => {
	const { userId, referenceId } = refreshToken;
	const consent =
		userId && referenceId
			? await ctx.runQuery(components.betterAuth.adapter.findOne, {
					model: 'oauthConsent',
					where: [
						{ field: 'clientId', operator: 'eq', value: refreshToken.clientId },
						{ field: 'referenceId', operator: 'eq', value: referenceId },
						{ field: 'userId', operator: 'eq', value: userId }
					],
					select: ['_id']
				})
			: null;
	if (!consent) reject('oauth_refresh_without_grant');
};
