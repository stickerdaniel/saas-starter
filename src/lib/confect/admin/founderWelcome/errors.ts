import { ConvexError } from 'convex/values';

export const FOUNDER_WELCOME_ERROR_CODES = {
	nameRequired: 'FOUNDER_WELCOME_NAME_REQUIRED',
	titleRequired: 'FOUNDER_WELCOME_TITLE_REQUIRED',
	subjectRequired: 'FOUNDER_WELCOME_SUBJECT_REQUIRED',
	bodyRequired: 'FOUNDER_WELCOME_BODY_REQUIRED',
	replyToInvalid: 'FOUNDER_WELCOME_REPLY_TO_INVALID',
	notCurrentContact: 'FOUNDER_WELCOME_NOT_CURRENT_CONTACT'
} as const;

export type FounderWelcomeErrorCode =
	(typeof FOUNDER_WELCOME_ERROR_CODES)[keyof typeof FOUNDER_WELCOME_ERROR_CODES];

export function createFounderWelcomeError(code: FounderWelcomeErrorCode) {
	return new ConvexError({ code });
}
