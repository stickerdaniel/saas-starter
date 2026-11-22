import { FunctionSpec, GroupSpec } from '@confect/core';
import type {
	sendAdminReplyNotification,
	sendFounderWelcomeEmail,
	sendNewTicketAdminNotification,
	sendNewUserSignupNotification,
	sendResetPasswordEmail,
	sendVerificationEmail
} from './send';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof sendAdminReplyNotification>()(
			'sendAdminReplyNotification'
		)
	)
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof sendFounderWelcomeEmail>()('sendFounderWelcomeEmail')
	)
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof sendNewTicketAdminNotification>()(
			'sendNewTicketAdminNotification'
		)
	)
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof sendNewUserSignupNotification>()(
			'sendNewUserSignupNotification'
		)
	)
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof sendResetPasswordEmail>()('sendResetPasswordEmail')
	)
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof sendVerificationEmail>()('sendVerificationEmail')
	);
