import * as v from 'valibot';

// Change Email Schema
export const changeEmailSchema = v.object({
	newEmail: v.pipe(
		v.string(),
		v.nonEmpty('Please enter your new email address.'),
		v.email('Please enter a valid email address.')
	)
});

// Types
export type ChangeEmailData = v.InferOutput<typeof changeEmailSchema>;
