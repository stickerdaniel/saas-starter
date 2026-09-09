import { v } from 'convex/values';
import { query } from './_generated/server';
import { getCapabilityConfigurations } from './env';
import { projectCapabilityUsability } from '../dev/features';

const capabilityStatus = v.union(
	v.object({ usable: v.literal(true) }),
	v.object({ usable: v.literal(false), reason: v.literal('unavailable') })
);

export const getUsability = query({
	args: {},
	returns: v.object({
		billing: capabilityStatus,
		ai: capabilityStatus
	}),
	handler: async () => projectCapabilityUsability(getCapabilityConfigurations())
});
