import * as v from 'valibot';

// Change Email Schema
export const changeEmailSchema = v.object({
	newEmail: v.pipe(
		v.string(),
		v.nonEmpty('validation.email.required'),
		v.email('validation.email.invalid')
	)
});

// Types
export type ChangeEmailData = v.InferOutput<typeof changeEmailSchema>;
