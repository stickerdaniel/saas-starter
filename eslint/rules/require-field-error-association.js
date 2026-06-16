/**
 * ESLint rule: require-field-error-association
 *
 * Inside a `<Field.Field>`, when a `<Field.Error>` showing dynamic field errors
 * (an `errors=` / `issues=` attribute bound to an expression) sits next to an
 * `<Input>` / `<Password.Input>`, the pair must be wired for screen readers:
 *
 *   - the input sets `aria-describedby` AND (`aria-invalid` OR `invalid`)
 *   - the `Field.Error` carries a matching `id`
 *
 * A `{...something.as(...)}` spread on the input satisfies the aria-invalid
 * requirement: the remote-form field helper injects a reactive `aria-invalid`.
 *
 * Form-level banner `Field.Error`s (a Field.Error not paired with an input in
 * the same Field.Field — e.g. the auth-error banner) are NOT flagged.
 *
 * ❌ <Field.Field>
 *      <Input id="email" bind:value={email} />
 *      <Field.Error errors={errs} />
 *    </Field.Field>
 * ✅ <Field.Field>
 *      <Input id="email" aria-invalid={x ? 'true' : undefined}
 *        aria-describedby={x ? 'email-error' : undefined} bind:value={email} />
 *      <Field.Error id="email-error" errors={errs} />
 *    </Field.Field>
 * ✅ <Field.Field>
 *      <Input {...form.fields.email.as('text')}
 *        aria-describedby={x ? 'email-error' : undefined} />
 *      <Field.Error id="email-error" errors={form.fields.email.issues()} />
 *    </Field.Field>
 */

const INPUT_NAMES = new Set(['Input', 'Password.Input']);

/** Resolve a SvelteElement's tag name: `Input` or `Field.Error`. */
function elementName(node) {
	const n = node.name;
	if (!n) return undefined;
	if (n.type === 'SvelteMemberExpressionName') {
		return `${n.object?.name}.${n.property?.name}`;
	}
	return n.name;
}

function attributes(node) {
	return node.startTag?.attributes ?? [];
}

function hasAttribute(node, name) {
	return attributes(node).some((a) => a.type === 'SvelteAttribute' && a.key?.name === name);
}

function hasSpread(node) {
	return attributes(node).some((a) => a.type === 'SvelteSpreadAttribute');
}

/** A Field.Error is "dynamic" when it binds errors/issues to an expression. */
function isDynamicFieldError(node) {
	return attributes(node).some(
		(a) =>
			a.type === 'SvelteAttribute' &&
			(a.key?.name === 'errors' || a.key?.name === 'issues') &&
			a.value?.some((v) => v.type === 'SvelteMustacheTag')
	);
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Require inputs paired with a dynamic Field.Error to set aria-describedby + aria-invalid/invalid, and the Field.Error to carry a matching id'
		},
		schema: [],
		messages: {
			inputMissingAria:
				'Input paired with a Field.Error must set aria-describedby and aria-invalid (or invalid) so screen readers announce the error.',
			fieldErrorMissingId:
				'A dynamic Field.Error paired with an input must carry an id matching the input aria-describedby.'
		}
	},
	create(context) {
		return {
			SvelteElement(node) {
				if (elementName(node) !== 'Field.Field') return;

				const childElements = (node.children ?? []).filter((c) => c.type === 'SvelteElement');
				const inputs = childElements.filter((c) => INPUT_NAMES.has(elementName(c)));
				const fieldErrors = childElements.filter(
					(c) => elementName(c) === 'Field.Error' && isDynamicFieldError(c)
				);

				// No input + dynamic Field.Error pair: not our concern (e.g. banner-only).
				if (inputs.length === 0 || fieldErrors.length === 0) return;

				for (const input of inputs) {
					const describedBy = hasAttribute(input, 'aria-describedby');
					// A spread (e.g. {...field.as('text')}) injects a reactive aria-invalid.
					const invalid =
						hasAttribute(input, 'aria-invalid') ||
						hasAttribute(input, 'invalid') ||
						hasSpread(input);

					if (!describedBy || !invalid) {
						context.report({ node: input, messageId: 'inputMissingAria' });
					}
				}

				for (const fieldError of fieldErrors) {
					if (!hasAttribute(fieldError, 'id')) {
						context.report({ node: fieldError, messageId: 'fieldErrorMissingId' });
					}
				}
			}
		};
	}
};
