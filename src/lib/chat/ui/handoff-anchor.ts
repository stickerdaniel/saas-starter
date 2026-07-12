import type { DisplayMessage } from '../core/types.js';

/**
 * Whether a message anchors the inline email prompt in a handed-off thread.
 *
 * Two handoff flows produce different message shapes: the widget button saves a
 * canned handoff response (detected by its localized opening sentence), while
 * Kai's request_handoff tool call leaves a normal assistant message whose parts
 * carry the tool invocation (tool parts are typed "tool-{toolName}"). Text
 * sniffing alone misses the tool flow, so the email field would never render
 * even though the thread is handed off and Kai points the user to it.
 */
export function isHandoffAnchor(
	message: Pick<DisplayMessage, 'displayText' | 'parts'>,
	handoffMessage: string
): boolean {
	if (handoffMessage && message.displayText?.startsWith(handoffMessage)) return true;
	return (message.parts ?? []).some((p) => p.type === 'tool-request_handoff');
}
