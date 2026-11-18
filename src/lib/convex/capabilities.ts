import { v } from 'convex/values';
import { query } from './_generated/server';
import { publicEndpoint } from './access';
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
	handler: async () => {
		publicEndpoint(
			'Every page, signed in or not, hides the controls of an unconfigured capability.'
		);
		return projectCapabilityUsability(getCapabilityConfigurations());
	}
});
