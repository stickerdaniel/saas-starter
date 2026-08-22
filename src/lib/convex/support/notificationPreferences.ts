import { SUPPORT_ERROR_CODES, createSupportError } from './errors';
import * as val from 'valibot';

const NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000;

export function shouldSendNotification(
	notificationEmail: string | undefined,
	notificationSentAt: number | undefined
): boolean {
	if (!notificationEmail) return false;
	if (!notificationSentAt) return true;
	return Date.now() - notificationSentAt >= NOTIFICATION_COOLDOWN_MS;
}

export function normalizeNotificationEmail(email: string): string | undefined {
	const normalized = email.trim().toLowerCase();
	if (normalized && !val.safeParse(val.pipe(val.string(), val.email()), normalized).success) {
		throw createSupportError(SUPPORT_ERROR_CODES.notificationEmailInvalid);
	}
	return normalized || undefined;
}
