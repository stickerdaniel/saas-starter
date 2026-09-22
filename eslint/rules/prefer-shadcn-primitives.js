/**
 * ESLint rule: prefer-shadcn-primitives
 *
 * App UI goes through shadcn-svelte. Native button, dialog, HTML title tooltips,
 * checkbox, select, textarea, and text-like input are the usual agent shortcut
 * and still compile, so this rule fails while the line is written (pre-commit
 * lint and CI).
 *
 * Path exemptions skip every visitor of this rule: ui wrappers, emails (including
 * future templates), ai-elements, prompt-kit, test fixtures, obfuscated-email.
 * Other exceptions are diagnostic-specific: {...props} waives only nativeButton;
 * iframe/a title waives only nativeTitle; file/hidden input types skip input-kind
 * reports, not title.
 *
 * ❌ <button onclick={...}>Save</button>
 * ❌ <dialog>...</dialog>
 * ❌ <span title={label}>
 * ❌ <Button title={label}>
 * ❌ <input type="checkbox" />
 * ❌ <select></select>
 * ❌ <textarea></textarea>
 * ❌ <input type="email" />
 * ✅ <Button onclick={...}>Save</Button>
 * ✅ <button type="button" {...props}>
 * ✅ <iframe title={name}>
 * ✅ <input type="file" hidden />
 * ✅ <Tooltip.Content>{label}</Tooltip.Content>
 */

const EXEMPT_PATH =
	/(?:\/components\/ui\/|\/emails\/|\/ai-elements\/|\/prompt-kit\/|\/test-fixtures\/|\/obfuscated-email\.svelte$)/u;
const TITLE_OK_NATIVE = new Set(['iframe', 'a']);
const TEXT_INPUT_TYPES = new Set(['text', 'email', 'password', 'search', 'tel', 'url', 'number']);

function posixFilename(context) {
	return String(context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
}

function elementName(element) {
	const name = element?.name;
	if (!name) return null;
	if (typeof name === 'string') return name;
	if (name.type === 'Identifier' || name.type === 'SvelteName') return name.name ?? null;
	return null;
}

function startAttributes(element) {
	return element.startTag?.attributes ?? element.attributes ?? [];
}

function hasPropsSpread(element) {
	return startAttributes(element).some(
		(attr) =>
			attr.type === 'SvelteSpreadAttribute' &&
			attr.argument?.type === 'Identifier' &&
			attr.argument.name === 'props'
	);
}

function ownerElement(node) {
	let current = node.parent;
	while (current && current.type !== 'SvelteElement') {
		current = current.parent;
	}
	return current ?? null;
}

function staticAttributeText(attribute) {
	if (attribute.type !== 'SvelteAttribute') return null;
	const value = attribute.value;
	if (!Array.isArray(value) || value.length === 0) return '';
	if (value.length !== 1) return null;
	const part = value[0];
	if (part.type === 'SvelteLiteral' && typeof part.value === 'string') return part.value;
	if (
		part.type === 'SvelteMustacheTag' &&
		part.expression?.type === 'Literal' &&
		typeof part.expression.value === 'string'
	) {
		return part.expression.value;
	}
	return null;
}

function inputType(element) {
	const typeAttr = startAttributes(element).find(
		(attr) =>
			(attr.type === 'SvelteAttribute' || attr.type === 'SvelteShorthandAttribute') &&
			attr.key?.name === 'type'
	);
	if (!typeAttr) return 'text';
	if (typeAttr.type === 'SvelteShorthandAttribute') return null;
	const text = staticAttributeText(typeAttr);
	if (text === null) return null;
	if (text === '') return 'text';
	return text.toLowerCase();
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow native button, dialog, HTML title tooltips, checkbox, select, textarea, and text-like input; use the matching shadcn primitive'
		},
		schema: [],
		messages: {
			nativeButton:
				'Use shadcn Button from $lib/components/ui/button instead of a native <button>. Spread {...props} onto <button> only as a bits-ui child host.',
			nativeDialog:
				'Use shadcn Dialog from $lib/components/ui/dialog instead of a native <dialog>.',
			nativeTitle:
				'Use shadcn Tooltip from $lib/components/ui/tooltip instead of the HTML title tooltip.',
			nativeCheckbox:
				'Use shadcn Checkbox from $lib/components/ui/checkbox instead of a native <input type="checkbox">.',
			nativeSelect:
				'Use shadcn Select from $lib/components/ui/select instead of a native <select>.',
			nativeTextarea:
				'Use shadcn Textarea from $lib/components/ui/textarea instead of a native <textarea>.',
			nativeInput:
				'Use shadcn Input from $lib/components/ui/input instead of a native text-like <input>.'
		}
	},
	create(context) {
		if (EXEMPT_PATH.test(posixFilename(context))) return {};

		function checkTitleAttribute(node) {
			if (node.key?.name !== 'title') return;
			const element = ownerElement(node);
			const name = elementName(element);
			if (!name || !element) return;
			if (name === 'Button') {
				context.report({ node, messageId: 'nativeTitle' });
				return;
			}
			if (element.kind === 'html' && !TITLE_OK_NATIVE.has(name)) {
				context.report({ node, messageId: 'nativeTitle' });
			}
		}

		return {
			SvelteElement(node) {
				if (node.kind !== 'html') return;
				const name = elementName(node);
				if (name === 'button' && !hasPropsSpread(node)) {
					context.report({ node, messageId: 'nativeButton' });
				}
				if (name === 'dialog') {
					context.report({ node, messageId: 'nativeDialog' });
				}
				if (name === 'select') {
					context.report({ node, messageId: 'nativeSelect' });
				}
				if (name === 'textarea') {
					context.report({ node, messageId: 'nativeTextarea' });
				}
				if (name === 'input') {
					const type = inputType(node);
					if (type === 'checkbox') {
						context.report({ node, messageId: 'nativeCheckbox' });
					} else if (type && TEXT_INPUT_TYPES.has(type)) {
						context.report({ node, messageId: 'nativeInput' });
					}
				}
			},
			SvelteAttribute: checkTitleAttribute,
			SvelteShorthandAttribute: checkTitleAttribute
		};
	}
};
