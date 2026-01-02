import { z } from 'zod';
import { useSearchParams } from 'runed/kit';

/**
 * Schema for support widget URL state
 * - support: 'open' when widget is visible, '' when closed
 * - thread: thread ID when viewing a specific conversation
 */
const supportUrlSchema = z.object({
	support: z.enum(['open', '']).default(''),
	thread: z.string().default('')
});

/**
 * Hook to manage support widget state in URL parameters.
 * Enables shareable links that open the widget to a specific thread.
 *
 * @example
 * // URL: /pricing?support=open&thread=k57abc123
 * const urlState = useSupportUrlState();
 * urlState.support; // 'open'
 * urlState.thread;  // 'k57abc123'
 *
 * // Update URL
 * urlState.support = 'open';  // Opens widget
 * urlState.thread = 'abc123'; // Navigates to thread
 */
export function useSupportUrlState() {
	return useSearchParams(supportUrlSchema, {
		pushHistory: true,
		noScroll: true
	});
}

export type SupportUrlState = ReturnType<typeof useSupportUrlState>;
