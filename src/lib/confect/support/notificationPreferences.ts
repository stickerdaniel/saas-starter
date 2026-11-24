const NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000;

export function shouldSendNotification(
	notificationEmail: string | undefined,
	notificationSentAt: number | undefined
): boolean {
	if (!notificationEmail) return false;
	if (!notificationSentAt) return true;
	return Date.now() - notificationSentAt >= NOTIFICATION_COOLDOWN_MS;
}
