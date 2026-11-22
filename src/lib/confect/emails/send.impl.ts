import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import {
	sendAdminReplyNotification,
	sendFounderWelcomeEmail,
	sendNewTicketAdminNotification,
	sendNewUserSignupNotification,
	sendResetPasswordEmail,
	sendVerificationEmail
} from './send';
import send from './send.spec';

export default GroupImpl.make(databaseSchema, send).pipe(
	Layer.provide([
		FunctionImpl.make(
			databaseSchema,
			send,
			'sendAdminReplyNotification',
			sendAdminReplyNotification
		),
		FunctionImpl.make(databaseSchema, send, 'sendFounderWelcomeEmail', sendFounderWelcomeEmail),
		FunctionImpl.make(
			databaseSchema,
			send,
			'sendNewTicketAdminNotification',
			sendNewTicketAdminNotification
		),
		FunctionImpl.make(
			databaseSchema,
			send,
			'sendNewUserSignupNotification',
			sendNewUserSignupNotification
		),
		FunctionImpl.make(databaseSchema, send, 'sendResetPasswordEmail', sendResetPasswordEmail),
		FunctionImpl.make(databaseSchema, send, 'sendVerificationEmail', sendVerificationEmail)
	]),
	GroupImpl.finalize
);
