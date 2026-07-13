import { feature, item, plan } from 'atmn';

// Coupons and promotion codes are NOT defined here. Autumn manages them as
// Stripe-side rewards through the dashboard; `atmn push` neither creates nor
// reads them, so a live discount never shows up in this config.

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
 * Automatically attached to new customers via autoEnable.
 */
export const free = plan({
	id: 'free',
	name: 'Free',
	autoEnable: true,
	items: [
		item({
			featureId: messages.id,
			included: 3,
			reset: { interval: 'month' }
		}),
		item({
			featureId: aiChatMessages.id,
			included: 3,
			reset: { interval: 'month' }
		})
	]
});

/**
 * Pro tier with unlimited community chat and 500 AI chat messages/month.
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
			included: 500,
			reset: { interval: 'month' }
		})
	]
});
