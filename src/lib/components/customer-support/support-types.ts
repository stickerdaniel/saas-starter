/** View types for the support widget navigation. */
export type SupportView = 'overview' | 'chat' | 'compose';

/** Thread summary for the overview list. */
export interface ThreadSummary {
	_id: string;
	_creationTime: number;
	userId?: string;
	title?: string;
	summary?: string;
	status: 'active' | 'archived';
	lastAgentName?: string;
	lastMessageRole?: 'user' | 'assistant' | 'tool' | 'system';
	lastMessage?: string;
	lastMessageAt?: number;
}

export type SupportHandoffOutcome =
	{ kind: 'applied' } | { kind: 'missing_thread' } | { kind: 'failed'; code: 'handoff_failed' };

export type NotificationEmailOutcome =
	| { kind: 'saved'; email: string | null }
	| { kind: 'missing_thread' }
	| { kind: 'failed'; code: 'notification_update_failed' };
