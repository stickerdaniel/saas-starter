import type { TFnType, DefaultParamType, TranslationKey } from '@tolgee/web';

/**
 * Type alias for Tolgee's translate function
 */
type TolgeeFn = TFnType<DefaultParamType, string, TranslationKey>;

/**
 * Type for Tolgee parameters (primitive values only)
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
 * @returns Array of { message: string } objects for FieldError component, or undefined
 *
 * @example
 * ```svelte
 * <script>
 *   import { getTranslate } from '@tolgee/svelte';
 *   import { translateValidationErrors } from '$lib/utils/validation-i18n';
 *   const { t } = getTranslate();
 * </script>
 *
 * <FieldError errors={translateValidationErrors(errors.email, $t)} />
 * ```
 */
export function translateValidationErrors(
	errors: string[] | undefined,
	t: TolgeeFn,
	params?: Record<string, TolgeeParams>
): { message: string }[] | undefined {
	if (!errors || errors.length === 0) return undefined;
	return errors.map((key) => ({
		message: params?.[key] ? t(key, params[key]) : t(key)
	}));
}

/**
 * Translates a single error message (e.g., formError) using Tolgee.
 *
 * @param error - Translation key or undefined
 * @param t - Tolgee translate function
 * @param params - Optional parameters for the translation
 * @returns Translated message or undefined
 */
export function translateError(
	error: string | undefined,
	t: TolgeeFn,
	params?: TolgeeParams
): string | undefined {
	if (!error) return undefined;
	return params ? t(error, params) : t(error);
}

/**
 * Converts a single translated error to FieldError format.
 *
 * @param error - Translation key or undefined
 * @param t - Tolgee translate function
 * @param params - Optional parameters for the translation
 * @returns Array with single { message: string } for FieldError, or undefined
 */
export function translateFormError(
	error: string | undefined,
	t: TolgeeFn,
	params?: TolgeeParams
): { message: string }[] | undefined {
	if (!error) return undefined;
	return [{ message: params ? t(error, params) : t(error) }];
}
