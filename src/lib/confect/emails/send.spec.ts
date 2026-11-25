import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { Id } from '../_generated/id';
import { NotificationMessagesSchema } from '../admin/support/schemas';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'sendAdminReplyNotification',
			args: () => ({
				supportThreadId: Id('supportThreads'),
				email: Schema.String,
				adminName: Schema.String,
				messagePreview: Schema.String,
				threadId: Schema.String,
				pageUrl: Schema.optional(Schema.String)
			}),
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'sendFounderWelcomeEmail',
			args: () => ({ founderWelcomeId: Id('founderWelcomeEmails') }),
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'sendNewTicketAdminNotification',
			args: () => ({
				email: Schema.String,
				isReopen: Schema.Boolean,
				isBareHandoff: Schema.Boolean,
				userName: Schema.String,
				messages: NotificationMessagesSchema,
				threadId: Schema.String
			}),
			returns: () => Schema.Boolean
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'sendNewUserSignupNotification',
			args: () => ({
				userName: Schema.optional(Schema.String),
				userEmail: Schema.String,
				signupMethod: Schema.Literals(['Email', 'Google', 'GitHub']),
				signupTime: Schema.String
			}),
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'sendResetPasswordEmail',
			args: () => ({
				email: Schema.String,
				resetUrl: Schema.String,
				userName: Schema.optional(Schema.String),
				userId: Schema.String
			}),
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'sendVerificationEmail',
			args: () => ({
				email: Schema.String,
				verificationUrl: Schema.String,
				expiryMinutes: Schema.optional(Schema.Number)
			}),
			returns: () => Schema.Null
		})
	);
