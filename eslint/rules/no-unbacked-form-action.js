/**
 * ESLint rule: no-unbacked-form-action
 *
 * A `<form action="...">` promises the browser a working submit without
 * JavaScript. This app cannot honour that promise for anything but a SvelteKit
 * form action: there are no `export const actions` anywhere, every write goes
 * through a Convex client mutation in the browser, and the Better Auth
 * endpoints answer with JSON instead of a redirect. An `action` pointing at an
 * API route therefore renders a fallback that shows the visitor raw JSON.
 *
 * Only literal values are judged. A dynamic action is the author's call.
 *
 * ✅ <form onsubmit={handleSubmit}>            (JS-only submit, no promise made)
 * ✅ <form method="POST" action="?/login">     (real SvelteKit form action)
 * ✅ <form method="POST" action="/en/signin?/login">
 * ❌ <form onsubmit={handleSubmit} action="/api/auth/sign-in/email" method="POST">
 */

/** Resolve a SvelteElement's tag name. */
function elementName(node) {
	const name = node.name;
	if (!name || name.type === 'SvelteMemberExpressionName') return undefined;
	return name.name;
}

/**
 * The literal text of an attribute, or undefined when any part of it is an
 * expression. `action="/a{b}"` is dynamic and not judged.
 */
function literalValue(attribute) {
	const parts = attribute.value ?? [];
	if (parts.length === 0) return '';
	if (!parts.every((part) => part.type === 'SvelteLiteral')) return undefined;
	return parts.map((part) => part.value).join('');
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow a form action that does not target a SvelteKit form action, because no other target survives without JavaScript'
		},
		schema: [],
		messages: {
			unbackedFormAction:
				'form action "{{action}}" is not a SvelteKit form action, so the no-JS submit it advertises cannot work. Point it at a "?/name" action, or drop action and method and let the onsubmit handler own the submit.'
		}
	},
	create(context) {
		return {
			SvelteElement(node) {
				if (elementName(node) !== 'form') return;

				for (const attribute of node.startTag?.attributes ?? []) {
					if (attribute.type !== 'SvelteAttribute') continue;
					if (attribute.key?.name !== 'action') continue;

					const action = literalValue(attribute);
					// Dynamic value, or an empty action targeting this route's default action.
					if (action === undefined || action === '') return;
					if (action.includes('?/')) return;

					context.report({ node: attribute, messageId: 'unbackedFormAction', data: { action } });
					return;
				}
			}
		};
	}
};
