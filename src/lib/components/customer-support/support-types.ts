/** View types for the support widget navigation. */
export type SupportView = 'overview' | 'chat' | 'compose';

export type SupportHandoffOutcome =
	{ kind: 'applied' } | { kind: 'missing_thread' } | { kind: 'failed'; code: 'handoff_failed' };

export type NotificationEmailOutcome =
	| { kind: 'saved'; email: string | null }
	| { kind: 'missing_thread' }
	| { kind: 'failed'; code: 'notification_update_failed' };
