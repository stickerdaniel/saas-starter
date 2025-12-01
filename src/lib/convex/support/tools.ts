import { tool } from 'ai';
import { z } from 'zod';

/**
 * Tool: Submit Support Ticket (Human-in-the-Loop)
 *
 * Prepares a support ticket for user review and submission.
 * This tool has NO handler - it pauses execution for user input.
 *
 * Flow:
 * 1. Agent calls this tool with ticket details
 * 2. UI displays a form with title, description, and email input
 * 3. User can review/edit and submit or cancel
 * 4. Tool result is saved based on user action
 * 5. Agent continues with the result
 */
export const submitSupportTicket = tool({
	description:
		'Prepare a support ticket for user confirmation. The UI will show a form for the user to review the ticket details, enter their email, and submit or cancel. Do not call this tool multiple times in a row - wait for user response.',
	inputSchema: z.object({
		ticketType: z
			.enum(['bug_report', 'feature_request', 'general_inquiry'])
			.describe(
				'Type of support ticket: bug_report for issues, feature_request for suggestions, general_inquiry for other questions'
			),
		title: z
			.string()
			.max(200)
			.describe('Brief title summarizing the issue or request (max 200 characters)'),
		description: z
			.string()
			.describe(
				'Detailed description including: steps to reproduce (for bugs), use case and expected behavior (for features), or full context (for inquiries)'
			),
		includeAttachments: z
			.boolean()
			.default(true)
			.describe('Whether to include files the user uploaded during this conversation')
	})
	// No execute function - enables human-in-the-loop
});
