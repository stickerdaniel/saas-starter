import * as v from 'valibot';

/**
 * Shared password validation constants and schemas.
 * All password validation rules are centralized here to prevent drift.
 */

export const PASSWORD_MIN_LENGTH = 10;

/**
 * Password validation pipe with all security requirements.
 * Uses translation keys for i18n support.
 */
export const passwordValidation = v.pipe(
	v.string(),
	v.minLength(PASSWORD_MIN_LENGTH, 'validation.password.min_length'),
	v.regex(/[A-Z]/, 'validation.password.uppercase'),
	v.regex(/[a-z]/, 'validation.password.lowercase'),
	v.regex(/[0-9]/, 'validation.password.number')
);

/**
 * Simple password field (just required, no complexity rules).
 * Used for signin forms where we don't validate password complexity.
 */
export const passwordRequired = v.pipe(v.string(), v.nonEmpty('validation.password.required'));

/**
 * Confirm password field (just required).
 */
export const confirmPasswordRequired = v.pipe(
	v.string(),
	v.nonEmpty('validation.confirm_password.required')
);

/** Translation key for password mismatch error */
export const PASSWORD_MISMATCH_KEY = 'validation.confirm_password.mismatch';
