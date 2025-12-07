import { query } from './_generated/server';
import { authComponent } from './auth';

export const viewer = query({
	args: {},
	handler: async (ctx) => {
		return authComponent.getAuthUser(ctx);
	}
});
