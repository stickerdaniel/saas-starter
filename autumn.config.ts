import { feature, item, plan } from 'atmn';

/**
 * Community chat messages - metered per month.
 */
export const messages = feature({
	id: 'messages',
	name: 'Messages',
	type: 'metered',
	consumable: true
});

/**
 * AI chat messages - metered per month.
 */
export const aiChatMessages = feature({
	id: 'ai_chat_messages',
	name: 'AI Chat Messages',
	type: 'metered',
	consumable: true
});

/**
 * Free tier with limited message usage.
 * Automatically attached to new customers via is_default.
 */
export const free = plan({
	id: 'free',
	name: 'Free',
	is_default: true,
	items: [
		item({
			featureId: messages.id,
			included: 10,
			reset: { interval: 'month' }
		})
	]
});

/**
 * Pro tier with unlimited community chat and 200 AI chat messages/month.
 */
export const pro = plan({
	id: 'pro',
	name: 'Pro',
	price: { amount: 10, interval: 'month' },
	items: [
		item({
			featureId: messages.id,
			unlimited: true,
			reset: { interval: 'month' }
		}),
		item({
			featureId: aiChatMessages.id,
			included: 200,
			reset: { interval: 'month' }
		})
	]
});
