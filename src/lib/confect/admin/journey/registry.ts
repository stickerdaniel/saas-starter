import { aiChatSource } from './sources/aiChat';
import { communitySource } from './sources/community';
import { supportSource } from './sources/support';

/**
 * The journey sources this app reads, in display order: their steps and tiles
 * appear in this order wherever times tie or tiles overflow. A fork adds a
 * source with one module under `sources/`, one entry here and its copy keys
 * under `email.customer_journey.source.<id>`.
 */
export const JOURNEY_SOURCES = [aiChatSource, communitySource, supportSource] as const;

export type JourneySourceId = (typeof JOURNEY_SOURCES)[number]['id'];
