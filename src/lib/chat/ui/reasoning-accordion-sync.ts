import type { DisplayMessage } from '../core/types.js';
import {
	getActiveStreamingReasoningIndex,
	getReasoningKey,
	LEADING_REASONING_KEY
} from './reasoning-parts.js';

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
				const partKey = `${message.id}:${getReasoningKey(parts, index)}`;
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

		// No renderable parts yet: the connecting fallback / cached reasoning shares the leading
		// reasoning key, so a user toggle here carries over once the real reasoning part arrives.
		const legacyKey = `${message.id}:${LEADING_REASONING_KEY}`;
		const hasReasoning = !!message.displayReasoning;
		const hasResponse = !!message.displayText;

		if (hasReasoning && !hasResponse) {
			validReasoningKeys.add(legacyKey);
			if (!controller.wasUserToggled(legacyKey)) {
				if (!controller.isReasoningOpen(legacyKey)) {
					controller.setReasoningOpen(legacyKey, true);
					controller.markAutoOpened(legacyKey);
				}
			}
		} else if (hasResponse && controller.wasAutoOpened(legacyKey)) {
			validReasoningKeys.add(legacyKey);
			if (!controller.wasUserToggled(legacyKey)) {
				controller.setReasoningOpen(legacyKey, false);
			}
			controller.clearAutoOpened(legacyKey);
			controller.clearUserToggled(legacyKey);
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
