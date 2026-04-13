import type { DisplayMessage } from '../core/types.js';
import { getActiveStreamingReasoningIndex, getReasoningPartKey } from './reasoning-parts.js';

export interface ReasoningAccordionController {
	isReasoningOpen(messageId: string): boolean;
	setReasoningOpen(messageId: string, isOpen: boolean): void;
	wasAutoOpened(messageId: string): boolean;
	markAutoOpened(messageId: string): void;
	clearAutoOpened(messageId: string): void;
	getAutoOpenedKeys(): Iterable<string>;
	wasUserToggled(messageId: string): boolean;
	clearUserToggled(messageId: string): void;
	getUserToggledKeys(): Iterable<string>;
}

export function syncReasoningAccordionState(
	messages: DisplayMessage[],
	controller: ReasoningAccordionController
): void {
	const validReasoningKeys = new Set<string>();

	messages.forEach((message) => {
		const parts = message.parts ?? [];

		if (parts.length > 0) {
			const isMessageInProgress = message.status === 'pending' || message.status === 'streaming';
			const activeReasoningIndex = getActiveStreamingReasoningIndex(parts, isMessageInProgress);

			parts.forEach((part, index) => {
				if (part.type !== 'reasoning') return;
				const partKey = `${message.id}:${getReasoningPartKey(part, index)}`;
				validReasoningKeys.add(partKey);

				if (index === activeReasoningIndex) {
					if (!controller.wasUserToggled(partKey)) {
						if (!controller.isReasoningOpen(partKey)) {
							controller.setReasoningOpen(partKey, true);
							controller.markAutoOpened(partKey);
						}
					}
				} else if (controller.wasAutoOpened(partKey)) {
					if (!controller.wasUserToggled(partKey)) {
						controller.setReasoningOpen(partKey, false);
					}
					controller.clearAutoOpened(partKey);
					controller.clearUserToggled(partKey);
				}
			});
			return;
		}

		const hasReasoning = !!message.displayReasoning;
		const hasResponse = !!message.displayText;

		if (hasReasoning && !hasResponse) {
			validReasoningKeys.add(message.id);
			if (!controller.wasUserToggled(message.id)) {
				if (!controller.isReasoningOpen(message.id)) {
					controller.setReasoningOpen(message.id, true);
					controller.markAutoOpened(message.id);
				}
			}
		} else if (hasResponse && controller.wasAutoOpened(message.id)) {
			validReasoningKeys.add(message.id);
			if (!controller.wasUserToggled(message.id)) {
				controller.setReasoningOpen(message.id, false);
			}
			controller.clearAutoOpened(message.id);
			controller.clearUserToggled(message.id);
		}
	});

	for (const autoOpenedKey of controller.getAutoOpenedKeys()) {
		if (validReasoningKeys.has(autoOpenedKey)) continue;
		controller.setReasoningOpen(autoOpenedKey, false);
		controller.clearAutoOpened(autoOpenedKey);
	}

	for (const toggledKey of controller.getUserToggledKeys()) {
		if (validReasoningKeys.has(toggledKey)) continue;
		controller.clearUserToggled(toggledKey);
	}
}
