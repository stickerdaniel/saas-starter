import * as v from 'valibot';

export const schema = v.object({
	id: v.number(),
	header: v.string(),
	type: v.string(),
	status: v.string(),
	target: v.string(),
	limit: v.string(),
	reviewer: v.string()
});

export type Schema = v.InferOutput<typeof schema>;
