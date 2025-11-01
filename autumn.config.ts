import { feature, product, featureItem, pricedFeatureItem, priceItem } from 'atmn';

/**
 * Defines single-use message features for billing and usage tracking.
 */
export const messages = feature({
	id: 'messages',
	name: 'Messages',
	type: 'single_use'
});

/**
 * Free tier product with limited message usage.
 * Automatically attached to new customers via is_default.
 */
export const free = product({
	id: 'free',
	name: 'Free',
	is_default: true,
	items: [
		featureItem({
			feature_id: messages.id,
			included_usage: 10,
			interval: 'month'
		})
	]
});

/**
 * Pro tier product with unlimited message usage and monthly pricing.
 */
export const pro = product({
	id: 'pro',
	name: 'Pro',
	items: [
		priceItem({
			price: 10,
			interval: 'month'
		}),
		featureItem({
			feature_id: messages.id,
			included_usage: 'inf',
			interval: 'month'
		})
	]
});
