import { atmn, feature, plan } from 'atmn';

// CLI 2 removes omitted versions, so retain inactive history alongside active plans.
// Omit dashboard-managed rewards, referrals, settings and webhooks to preserve them.

/**
 * Community chat messages - metered per month.
 */
const messages = feature({
	featureId: 'messages',
	name: 'Messages',
	type: 'metered',
	consumable: true
});

/**
 * AI chat messages - metered per month.
 */
const aiChatMessages = feature({
	featureId: 'ai_chat_messages',
	name: 'AI Chat Messages',
	type: 'metered',
	consumable: true
});

const freeV1 = plan({
	planId: 'free',
	name: 'Free',
	versionSlug: 'v1',
	active: false,
	autoEnable: false,
	items: [{ featureId: messages.featureId, included: 3, reset: { interval: 'month' } }]
});

const free = plan({
	planId: 'free',
	name: 'Free',
	versionSlug: 'v2',
	active: true,
	autoEnable: true,
	items: [
		{
			featureId: messages.featureId,
			included: 3,
			reset: { interval: 'month' }
		},
		{
			featureId: aiChatMessages.featureId,
			included: 3,
			reset: { interval: 'month' }
		}
	]
});

/**
 * Pro tier with unlimited community chat and 30 AI chat messages/month.
 */
const pro = plan({
	planId: 'pro',
	name: 'Pro',
	versionSlug: 'v1',
	active: true,
	autoEnable: false,
	price: { amount: 10, interval: 'month' },
	items: [
		{
			featureId: messages.featureId,
			unlimited: true,
			reset: { interval: 'month' }
		},
		{
			featureId: aiChatMessages.featureId,
			included: 30,
			reset: { interval: 'month' }
		}
	]
});

export default atmn({
	features: [messages, aiChatMessages],
	plans: [freeV1, free, pro]
});
