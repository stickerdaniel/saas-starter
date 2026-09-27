/**
 * ESLint rule: require-static-mode-initializer
 *
 * Requires the root layout's mode-watcher `<ModeWatcher>` to pass an explicit
 * true `disableHeadScriptInjection` that no later spread can override.
 *
 * Why: src/app.html runs a copy of mode-watcher's initial-mode script, and the
 * report-only CSP hashes it from that template (src/lib/security/csp.js). Without
 * the prop, ModeWatcher injects a second initializer serialized from bundled
 * function source, whose bytes and hash change with the bundler, so the policy
 * cannot allow it (saas-starter #1019).
 *
 * ❌ <ModeWatcher synchronousModeChanges />
 * ❌ <ModeWatcher disableHeadScriptInjection={false} />
 * ❌ <ModeWatcher disableHeadScriptInjection {...props} />
 * ✅ <ModeWatcher disableHeadScriptInjection synchronousModeChanges />
 * ✅ <ModeWatcher {...props} disableHeadScriptInjection={true} />
 *
 * Scope: enabled for src/routes/+layout.svelte only, the one place that mounts
 * ModeWatcher. The binding is resolved from the import, so a renamed named import
 * or a namespace import is checked too; a shorthand or computed value counts as
 * unproven and is reported.
 */

const MODE_WATCHER_SOURCE = 'mode-watcher';
const COMPONENT_NAME = 'ModeWatcher';
const PROP_NAME = 'disableHeadScriptInjection';

function importedName(node) {
	if (node?.type === 'Identifier') return node.name;
	if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
	return null;
}

/** `prop` or `prop={true}`. */
function isExplicitTrue(attribute) {
	if (attribute.boolean) return true;
	if (attribute.value.length !== 1) return false;
	const [value] = attribute.value;
	return (
		value.type === 'SvelteMustacheTag' &&
		value.expression.type === 'Literal' &&
		value.expression.value === true
	);
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Require ModeWatcher to disable its head script so src/app.html owns the theme initializer'
		},
		schema: [],
		messages: {
			injectedInitializer:
				'Pass disableHeadScriptInjection to ModeWatcher as true, after any spread: src/app.html owns the theme initializer and its CSP hash, while the head script ModeWatcher injects is serialized from bundled function source whose hash drifts with every build.'
		}
	},
	create(context) {
		const componentNames = new Set();
		const namespaceNames = new Set();

		function isModeWatcher(name) {
			if (name.type === 'Identifier') return componentNames.has(name.name);
			return (
				name.type === 'SvelteMemberExpressionName' &&
				name.object.type === 'Identifier' &&
				namespaceNames.has(name.object.name) &&
				name.property.name === COMPONENT_NAME
			);
		}

		return {
			ImportDeclaration(node) {
				if (node.source.value !== MODE_WATCHER_SOURCE) return;
				for (const specifier of node.specifiers) {
					if (specifier.type === 'ImportNamespaceSpecifier') {
						namespaceNames.add(specifier.local.name);
					} else if (
						specifier.type === 'ImportSpecifier' &&
						importedName(specifier.imported) === COMPONENT_NAME
					) {
						componentNames.add(specifier.local.name);
					}
				}
			},
			SvelteElement(node) {
				if (node.kind !== 'component' || !isModeWatcher(node.name)) return;

				// Later attributes win, so only the last word on the prop counts, and a
				// spread after it could carry disableHeadScriptInjection: false.
				let disabled = false;
				for (const attribute of node.startTag.attributes) {
					if (attribute.type === 'SvelteSpreadAttribute') disabled = false;
					if (attribute.type === 'SvelteShorthandAttribute' && attribute.key.name === PROP_NAME) {
						disabled = false;
					}
					if (attribute.type === 'SvelteAttribute' && attribute.key.name === PROP_NAME) {
						disabled = isExplicitTrue(attribute);
					}
				}

				if (!disabled) context.report({ node: node.startTag, messageId: 'injectedInitializer' });
			}
		};
	}
};
