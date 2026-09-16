/**
 * ESLint rule: prefer-shadcn-primitives
 *
 * App UI goes through shadcn-svelte. Native <button>, <dialog>, and HTML title
 * tooltips are the usual agent shortcut and still compile, so this rule fails
 * while the line is written (pre-commit lint and CI).
 *
 * Spread {...props} onto a native <button> remains allowed: that is the bits-ui
 * child-host pattern. HTML title stays allowed on iframe (accessible name) and
 * <a> (markdown title). Wrappers under ui/, emails, ai-elements, prompt-kit,
 * and test fixtures own native elements on purpose.
 *
 * ❌ <button onclick={...}>Save</button>
 * ❌ <dialog>...</dialog>
 * ❌ <span title={label}>
 * ❌ <Button title={label}>
 * ✅ <Button onclick={...}>Save</Button>
 * ✅ <button type="button" {...props}>
 * ✅ <iframe title={name}>
 * ✅ <Tooltip.Content>{label}</Tooltip.Content>
 */

const EXEMPT_PATH =
	/(?:\/components\/ui\/|\/emails\/|\/ai-elements\/|\/prompt-kit\/|\/test-fixtures\/|\/obfuscated-email\.svelte$)/u;
const TITLE_OK_NATIVE = new Set(['iframe', 'a']);

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

function hasSpread(element) {
	return startAttributes(element).some((attr) => attr.type === 'SvelteSpreadAttribute');
}

function ownerElement(node) {
	let current = node.parent;
	while (current && current.type !== 'SvelteElement') {
		current = current.parent;
	}
	return current ?? null;
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow native button, dialog, and HTML title tooltips; use shadcn Button, Dialog, and Tooltip'
		},
		schema: [],
		messages: {
			nativeButton:
				'Use shadcn Button from $lib/components/ui/button instead of a native <button>. Spread {...props} onto <button> only as a bits-ui child host.',
			nativeDialog:
				'Use shadcn Dialog from $lib/components/ui/dialog instead of a native <dialog>.',
			nativeTitle:
				'Use shadcn Tooltip from $lib/components/ui/tooltip instead of the HTML title tooltip.'
		}
	},
	create(context) {
		if (EXEMPT_PATH.test(posixFilename(context))) return {};

		return {
			SvelteElement(node) {
				const name = elementName(node);
				if (name === 'button' && !hasSpread(node)) {
					context.report({ node, messageId: 'nativeButton' });
				}
				if (name === 'dialog') {
					context.report({ node, messageId: 'nativeDialog' });
				}
			},
			SvelteAttribute(node) {
				if (node.key?.name !== 'title') return;
				const element = ownerElement(node);
				const name = elementName(element);
				if (!name) return;
				if (name === 'Button') {
					context.report({ node, messageId: 'nativeTitle' });
					return;
				}
				if (/^[a-z]/u.test(name) && !TITLE_OK_NATIVE.has(name)) {
					context.report({ node, messageId: 'nativeTitle' });
				}
			}
		};
	}
};
