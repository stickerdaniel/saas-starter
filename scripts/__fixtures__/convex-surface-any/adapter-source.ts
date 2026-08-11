import { query } from './_generated/server';

export const adapter = {
	api() {
		return {
			adapted: query({ handler: async () => null })
		};
	}
};
