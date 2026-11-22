import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import {
	recordFounderEmailSendFailure,
	sendFounderCancellationEmail,
	sendFounderFeedbackEmail,
	setPersonalEmailSuppression
} from './founderEmails';
import founderEmails from './founderEmails.spec';

export default GroupImpl.make(databaseSchema, founderEmails).pipe(
	Layer.provide([
		FunctionImpl.make(
			databaseSchema,
			founderEmails,
			'recordFounderEmailSendFailure',
			recordFounderEmailSendFailure
		),
		FunctionImpl.make(
			databaseSchema,
			founderEmails,
			'sendFounderCancellationEmail',
			sendFounderCancellationEmail
		),
		FunctionImpl.make(
			databaseSchema,
			founderEmails,
			'sendFounderFeedbackEmail',
			sendFounderFeedbackEmail
		),
		FunctionImpl.make(
			databaseSchema,
			founderEmails,
			'setPersonalEmailSuppression',
			setPersonalEmailSuppression
		)
	]),
	GroupImpl.finalize
);
