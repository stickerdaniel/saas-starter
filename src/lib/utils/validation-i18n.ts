import type { TFnType, DefaultParamType, TranslationKey } from '@tolgee/web';

/**
 * Type alias for Tolgee's translate function
 */
type TolgeeFn = TFnType<DefaultParamType, string, TranslationKey>;

/**
 * Type for Tolgee parameters (serializable values)
 */
type TolgeeParams = Record<string, string | number | bigint | boolean | Date | null | undefined>;

/**
 * Translates Valibot validation error messages using Tolgee.
 *
 * Valibot schemas use translation keys as error messages (e.g., 'validation.email.invalid').
 * This function translates those keys at render time using the provided translate function.
 *
 * @param errors - Array of translation keys from Valibot validation
 * @param t - Tolgee translate function ($t from getTranslate())
 * @param params - Optional per-key parameters for parameterized translations
 * @returns Array of { message: string } objects for Field.Error component, or undefined
 *
 * @example
 * ```svelte
 * <script>
 *   import { getTranslate } from '@tolgee/svelte';
 *   import { translateValidationErrors } from '$lib/utils/validation-i18n';
 *   const { t } = getTranslate();
 * </script>
 *
 * <Field.Error errors={translateValidationErrors(errors.email, $t)} />
 * ```
 */
export function translateValidationErrors(
	errors: string[] | undefined,
	t: TolgeeFn,
	params?: Record<string, TolgeeParams>
): Array<{ message: string }> | undefined {
	if (!errors || errors.length === 0) return undefined;
	return errors.map((key) => ({
		message: params?.[key] ? t(key, params[key]) : t(key)
	}));
}

/**
 * Translates SvelteKit remote-form validation issues using Tolgee.
 *
 * Remote forms (`form(schema, handler)`) expose `field.issues()` as
 * `{ message, path }[]` where `message` holds the translation key from the
 * Valibot schema (or from `invalid(issue.field(key))` in the handler).
 *
 * @param issues - Issues from `field.issues()` on a remote form
 * @param t - Tolgee translate function ($t from getTranslate())
 * @param params - Optional per-key parameters for parameterized translations
 * @returns Array of { message: string } objects for Field.Error component, or undefined
 *
 * @example
 * ```svelte
 * <Field.Error errors={translateRemoteFormIssues(addEmailForm.fields.email.issues(), $t)} />
 * ```
 */
export function translateRemoteFormIssues(
	issues: ReadonlyArray<{ message: string }> | undefined,
	t: TolgeeFn,
	params?: Record<string, TolgeeParams>
): Array<{ message: string }> | undefined {
	if (!issues || issues.length === 0) return undefined;
	return issues.map(({ message }) => ({
		message: params?.[message] ? t(message, params[message]) : t(message)
	}));
}

/**
 * Converts a single translated error to Field.Error format.
 *
 * @param error - Translation key or undefined
 * @param t - Tolgee translate function
 * @param params - Optional parameters for the translation
 * @returns Array with single { message: string } for Field.Error, or undefined
 */
export function translateFormError(
	error: string | undefined,
	t: TolgeeFn,
	params?: TolgeeParams
): Array<{ message: string }> | undefined {
	if (!error) return undefined;
	return [{ message: params ? t(error, params) : t(error) }];
}
