import { ConvexError, type Value } from 'convex/values';
import * as Schema from 'effect/Schema';
import { describe, expect, it } from 'vitest';
import { ADMIN_ERROR_CODES } from '../../confect/admin/errors';
import { NOTIFICATION_EMAIL_ALREADY_EXISTS } from '../../confect/admin/notificationPreferences/errors';
import {
	AUTH_REFUSAL_CODES,
	AdminAccessRequired,
	AdminAccessRequiredCodec,
	AdminRefusal,
	AdminRefusalCodec,
	AuthRefusal,
	AuthRefusalCodec,
	NotificationPreferenceRefusal,
	NotificationPreferenceRefusalCodec,
	RateLimitedCodec
} from '../../confect/errorCodecs';
import { RateLimited } from '../../effect/errors';
import { getAuthErrorKey } from '../auth-messages';
import { getConvexErrorCode, getConvexErrorData } from '../convex-errors';

const sent = <Type, Encoded extends Value>(codec: Schema.Codec<Type, Encoded>, error: Type) =>
	new ConvexError(Schema.encodeSync(codec)(error));

const admin = (code: AdminRefusal['code']) => sent(AdminRefusalCodec, new AdminRefusal({ code }));
const auth = (code: AuthRefusal['code']) => sent(AuthRefusalCodec, new AuthRefusal({ code }));

describe('the refusals the backend sends', () => {
	it('carry the code each admin page branches on', () => {
		const cases = [
			[sent(AdminAccessRequiredCodec, new AdminAccessRequired()), 'ADMIN_ACCESS_REQUIRED'],
			[admin(ADMIN_ERROR_CODES.cannotChangeOwnRole), 'ADMIN_CANNOT_CHANGE_OWN_ROLE'],
			[admin(ADMIN_ERROR_CODES.userNotFound), 'ADMIN_USER_NOT_FOUND'],
			[admin(ADMIN_ERROR_CODES.lastAdmin), 'ADMIN_LAST_ADMIN'],
			[admin(ADMIN_ERROR_CODES.seedAdminExists), 'ADMIN_ALREADY_EXISTS'],
			[
				sent(
					NotificationPreferenceRefusalCodec,
					new NotificationPreferenceRefusal({ code: NOTIFICATION_EMAIL_ALREADY_EXISTS })
				),
				NOTIFICATION_EMAIL_ALREADY_EXISTS
			]
		] as const;
		expect(cases.map(([error]) => getConvexErrorCode(error))).toEqual(
			cases.map(([, code]) => code)
		);
	});

	it('translate to the auth message each page shows', () => {
		const cases = [
			[getConvexErrorData(admin('ADMIN_CANNOT_BAN_SELF')), 'auth.messages.admin_cannot_ban_self'],
			[
				getConvexErrorData(admin('ADMIN_ACTION_NOT_ALLOWED')),
				'auth.messages.admin_action_not_allowed'
			],
			[getConvexErrorData(admin('ADMIN_AUTH_ACTION_FAILED')), 'auth.messages.admin_action_failed'],
			[
				sent(RateLimitedCodec, new RateLimited({ retryAfter: 4_000 })).data,
				'auth.messages.rate_limited'
			],
			[auth('PASSWORD_TOO_SHORT').data, 'auth.messages.password_too_short']
		] as const;
		expect(cases.map(([data]) => getAuthErrorKey(data))).toEqual(cases.map(([, key]) => key));
		const unbranched = AUTH_REFUSAL_CODES.filter(
			(code) =>
				getAuthErrorKey({ code: getConvexErrorData(auth(code))?.code }, 'fallback') === 'fallback'
		);
		expect(unbranched).toEqual([]);
	});
});
