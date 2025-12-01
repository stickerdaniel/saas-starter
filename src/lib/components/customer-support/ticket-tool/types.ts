export type ToolState =
	| 'input-streaming'
	| 'input-available'
	| 'output-processing'
	| 'output-available'
	| 'output-error';

export type TicketType = 'bug_report' | 'feature_request' | 'general_inquiry';

export type ToolPart = {
	type: string;
	state: ToolState;
	// Ticket-specific fields (prefilled by agent)
	title?: string;
	description?: string;
	ticketType?: TicketType;
	includeAttachments?: boolean;
	// Tool call fields
	toolCallId?: string;
	errorText?: string;
};

export type TicketSubmitData = {
	title: string;
	description: string;
	email: string;
	ticketType: TicketType;
};
