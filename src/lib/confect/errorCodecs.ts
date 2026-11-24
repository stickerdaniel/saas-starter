import * as Data from 'effect/Data';
import * as Schema from 'effect/Schema';
import * as SchemaTransformation from 'effect/SchemaTransformation';
import type { AdminAuthErrorCode } from './admin/adminAuthErrors';
import { RateLimited, Unauthenticated } from '../effect/errors';
import { ADMIN_ERROR_CODES, type AdminErrorCode } from './admin/errors';
import { ADMIN_SUPPORT_ERROR_CODES } from './admin/support/errors';
import {
	FOUNDER_WELCOME_ERROR_CODES,
	type FounderWelcomeErrorCode
} from './admin/founderWelcome/errors';
import {
	NOTIFICATION_EMAIL_ALREADY_EXISTS,
	NOTIFICATION_PREFERENCE_ERROR_CODES,
	type NotificationPreferenceErrorCode
} from './admin/notificationPreferences/errors';
import { FILE_ERROR_CODES } from './files/errors';
import { SUPPORT_ERROR_CODES } from './support/errors';

const wireCodec = <Wire extends Schema.Top, Fields, Error extends object>(
	ErrorClass: new (fields: Fields) => Error,
	wire: Wire,
	toFields: (value: Wire['Type']) => Fields,
	toWire: (error: Error) => Wire['Type']
) =>
	wire.pipe(
		Schema.decodeTo(
			Schema.instanceOf(ErrorClass),
			SchemaTransformation.transform({
				decode: (value: Wire['Type']) => new ErrorClass(toFields(value)),
				encode: toWire
			})
		)
	);

export const UnauthenticatedCodec = wireCodec(
	Unauthenticated,
	Schema.Literal('Unauthenticated'),
	() => undefined,
	() => 'Unauthenticated' as const
);

export class AdminAccessRequired extends Data.TaggedError('AdminAccessRequired') {}

export const AdminAccessRequiredCodec = wireCodec(
	AdminAccessRequired,
	Schema.Struct({ code: Schema.Literal(ADMIN_ERROR_CODES.accessRequired) }),
	() => undefined,
	() => ({ code: ADMIN_ERROR_CODES.accessRequired })
);

const ADMIN_REFUSAL_CODES = [
	ADMIN_ERROR_CODES.cannotChangeOwnRole,
	ADMIN_ERROR_CODES.userNotFound,
	ADMIN_ERROR_CODES.lastAdmin,
	ADMIN_ERROR_CODES.seedAdminExists,
	'ADMIN_CANNOT_BAN_SELF',
	'ADMIN_ACTION_NOT_ALLOWED',
	'ADMIN_AUTH_ACTION_FAILED'
] as const satisfies ReadonlyArray<AdminErrorCode | AdminAuthErrorCode>;

export class AdminRefusal extends Data.TaggedError('AdminRefusal')<{
	readonly code: (typeof ADMIN_REFUSAL_CODES)[number];
}> {}

export const AdminRefusalCodec = wireCodec(
	AdminRefusal,
	Schema.Struct({ code: Schema.Literals(ADMIN_REFUSAL_CODES) }),
	({ code }) => ({ code }),
	({ code }) => ({ code })
);

export class FounderWelcomeRefusal extends Data.TaggedError('FounderWelcomeRefusal')<{
	readonly code: FounderWelcomeErrorCode;
}> {}

export const FounderWelcomeRefusalCodec = wireCodec(
	FounderWelcomeRefusal,
	Schema.Struct({ code: Schema.Literals(Object.values(FOUNDER_WELCOME_ERROR_CODES)) }),
	({ code }) => ({ code }),
	({ code }) => ({ code })
);

export const RateLimitedCodec = wireCodec(
	RateLimited,
	Schema.Struct({ code: Schema.Literal('RATE_LIMITED'), retryAfter: Schema.Number }),
	({ retryAfter }) => ({ retryAfter }),
	({ retryAfter }) => ({ code: 'RATE_LIMITED' as const, retryAfter })
);

export const AUTH_REFUSAL_CODES = [
	'INVALID_EMAIL_OR_PASSWORD',
	'INVALID_EMAIL',
	'INVALID_PASSWORD',
	'CREDENTIAL_ACCOUNT_NOT_FOUND',
	'USER_ALREADY_EXISTS',
	'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
	'EMAIL_NOT_VERIFIED',
	'INVALID_TOKEN',
	'TOKEN_EXPIRED',
	'PASSWORD_TOO_SHORT',
	'PASSWORD_ALREADY_SET',
	'PASSWORD_TOO_LONG',
	'PROVIDER_NOT_FOUND',
	'SOCIAL_ACCOUNT_ALREADY_LINKED',
	'LINKED_ACCOUNT_ALREADY_EXISTS',
	'FAILED_TO_GET_USER_INFO',
	'USER_EMAIL_NOT_FOUND',
	'EMAIL_MISMATCH',
	'AUTH_CANCELLED',
	'CHALLENGE_NOT_FOUND',
	'PASSKEY_NOT_FOUND',
	'AUTHENTICATION_FAILED',
	'FAILED_TO_VERIFY_REGISTRATION',
	'YOU_ARE_NOT_ALLOWED_TO_REGISTER_THIS_PASSKEY',
	'RATE_LIMITED',
	'SESSION_NOT_FRESH',
	'PASSWORD_TOO_WEAK',
	'CREDENTIAL_ACCOUNT_UNUSABLE',
	'IMPERSONATION_NOT_ALLOWED',
	'FAILED_TO_CREATE_USER',
	'FAILED_TO_CREATE_SESSION',
	'USER_NOT_FOUND',
	'ADMIN_CANNOT_BAN_SELF',
	'ADMIN_USER_NOT_FOUND',
	'ADMIN_ACTION_NOT_ALLOWED',
	'ADMIN_AUTH_ACTION_FAILED'
] as const;

export class AuthRefusal extends Data.TaggedError('AuthRefusal')<{
	readonly code: (typeof AUTH_REFUSAL_CODES)[number];
}> {}

export const AuthRefusalCodec = wireCodec(
	AuthRefusal,
	Schema.Struct({ code: Schema.Literals(AUTH_REFUSAL_CODES) }),
	({ code }) => ({ code }),
	({ code }) => ({ code })
);

const NOTIFICATION_PREFERENCE_REFUSAL_CODES = [
	NOTIFICATION_EMAIL_ALREADY_EXISTS,
	...Object.values(NOTIFICATION_PREFERENCE_ERROR_CODES)
] satisfies readonly NotificationPreferenceErrorCode[];

export class NotificationPreferenceRefusal extends Data.TaggedError(
	'NotificationPreferenceRefusal'
)<{
	readonly code: NotificationPreferenceErrorCode;
}> {}

export const NotificationPreferenceRefusalCodec = wireCodec(
	NotificationPreferenceRefusal,
	Schema.Struct({ code: Schema.Literals(NOTIFICATION_PREFERENCE_REFUSAL_CODES) }),
	({ code }) => ({ code }),
	({ code }) => ({ code })
);

const FileRefusalWire = Schema.Union([
	Schema.Struct({
		code: Schema.Literal(FILE_ERROR_CODES.tooLarge),
		maxBytes: Schema.Number,
		actualBytes: Schema.Number
	}),
	Schema.Struct({
		code: Schema.Literal(FILE_ERROR_CODES.typeNotAllowed),
		allowedTypes: Schema.optionalKey(Schema.Array(Schema.String))
	}),
	Schema.Struct({
		code: Schema.Literals([
			FILE_ERROR_CODES.uploadRateLimited,
			FILE_ERROR_CODES.previewRateLimited
		]),
		retryAfter: Schema.Number
	}),
	Schema.Struct({ code: Schema.Literal(FILE_ERROR_CODES.metadataLimit), maxUrls: Schema.Number }),
	Schema.Struct({
		code: Schema.Literals([FILE_ERROR_CODES.fetchFailed, FILE_ERROR_CODES.storageUnavailable])
	})
]);

export class FileRefusal extends Data.TaggedError('FileRefusal')<{
	readonly refusal: typeof FileRefusalWire.Type;
}> {}

export const FileRefusalCodec = wireCodec(
	FileRefusal,
	FileRefusalWire,
	(refusal) => ({ refusal }),
	({ refusal }) => refusal
);

const SupportRefusalWire = Schema.Struct({
	code: Schema.Literals([
		SUPPORT_ERROR_CODES.authenticationRequired,
		SUPPORT_ERROR_CODES.threadNotFound,
		SUPPORT_ERROR_CODES.threadForbidden,
		SUPPORT_ERROR_CODES.anonymousUserInvalid,
		SUPPORT_ERROR_CODES.notificationEmailInvalid
	])
});

export class SupportRefusal extends Data.TaggedError('SupportRefusal')<{
	readonly refusal: typeof SupportRefusalWire.Type;
}> {}

export const SupportRefusalCodec = wireCodec(
	SupportRefusal,
	SupportRefusalWire,
	(refusal) => ({ refusal }),
	({ refusal }) => refusal
);

const AdminSupportRefusalWire = Schema.Union([
	Schema.Struct({
		code: Schema.Literal(ADMIN_SUPPORT_ERROR_CODES.messageTooLong),
		maxLength: Schema.Number
	}),
	Schema.Struct({
		code: Schema.Literals([
			ADMIN_SUPPORT_ERROR_CODES.threadNotFound,
			ADMIN_SUPPORT_ERROR_CODES.emptyMessage,
			ADMIN_SUPPORT_ERROR_CODES.emptyNote,
			ADMIN_SUPPORT_ERROR_CODES.assigneeNotAdmin
		])
	})
]);

export class AdminSupportRefusal extends Data.TaggedError('AdminSupportRefusal')<{
	readonly refusal: typeof AdminSupportRefusalWire.Type;
}> {}

export const AdminSupportRefusalCodec = wireCodec(
	AdminSupportRefusal,
	AdminSupportRefusalWire,
	(refusal) => ({ refusal }),
	({ refusal }) => refusal
);
