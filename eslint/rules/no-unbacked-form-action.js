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
 * A form action target is a URL carrying a search key that starts with `/`,
 * which is how SvelteKit names the action (`call_action` in
 * node_modules/@sveltejs/kit/src/runtime/server/page/actions.js). It only
 * dispatches on POST (`is_action_request` in the same file), and a GET submit
 * replaces the query string with the form data, so an action target on a GET
 * form never arrives.
 *
 * Submitters carry the same promise through `formaction` and `formmethod`, so
 * they are judged with the enclosing form's method as their default.
 *
 * Two things are deliberately out of scope. A dynamic action is the author's
 * call. A form with no action, or an empty one, targets its own route's default
 * action, and whether that route exports one is not decidable from the template.
 *
 * ✅ <form onsubmit={handleSubmit}>            (JS-only submit, no promise made)
 * ✅ <form method="POST" action="?/login">     (real SvelteKit form action)
 * ✅ <form method="GET" action="/search">      (ordinary navigation)
 * ❌ <form onsubmit={handleSubmit} action="/api/auth/sign-in/email" method="POST">
 * ❌ <form action="?/login">                   (defaults to GET, drops the action)
 * ❌ <button formaction="/api/auth/sign-in/email">  (inside a POST form)
 */

import { sanitizeTerminalField } from '../control-character-policy.js';

/** Resolve a SvelteElement's tag name, or undefined for a component. */
function elementName(node) {
	const name = node.name;
	if (!name || name.type === 'SvelteMemberExpressionName') return undefined;
	return name.name;
}

function attributes(node) {
	return node.startTag?.attributes ?? [];
}

/** Attributes are case-insensitive in HTML, and Svelte passes the spelling through. */
function findAttribute(node, name) {
	return attributes(node).find(
		(attribute) =>
			attribute.type === 'SvelteAttribute' && attribute.key?.name?.toLowerCase() === name
	);
}

/**
 * The statically known text of an attribute, or undefined when any part of it
 * is computed. A mustache holding a string literal is static.
 */
function staticValue(attribute) {
	if (!attribute) return undefined;
	const parts = attribute.value ?? [];
	if (parts.length === 0) return '';

	let text = '';
	for (const part of parts) {
		if (part.type === 'SvelteLiteral') {
			text += part.value;
			continue;
		}
		if (
			part.type === 'SvelteMustacheTag' &&
			part.expression?.type === 'Literal' &&
			typeof part.expression.value === 'string'
		) {
			text += part.expression.value;
			continue;
		}
		return undefined;
	}
	return text;
}

/**
 * Whether SvelteKit would read a form action name out of this URL: a search key
 * starting with `/`. Parsing against a base drops the fragment and decodes the
 * query the same way the runtime does.
 */
function targetsFormAction(action) {
	let url;
	try {
		url = new URL(action, 'https://form-action.invalid');
	} catch {
		return false;
	}
	for (const [key] of url.searchParams) {
		if (key.startsWith('/')) return true;
	}
	return false;
}

/** The literal method text, lowercased, or undefined when it is computed. */
function methodOf(attribute) {
	const value = staticValue(attribute);
	return value === undefined ? undefined : value.trim().toLowerCase();
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Require a form or submitter action to target a SvelteKit form action on POST, because no other target survives without JavaScript'
		},
		schema: [],
		messages: {
			unbackedFormAction:
				'{{attribute}} "{{action}}" is not a SvelteKit form action, so the no-JS submit it advertises cannot work. Point it at a "?/name" action, or drop the action and method and let the onsubmit handler own the submit.',
			formActionNeedsPost:
				'{{attribute}} "{{action}}" names a SvelteKit form action, but the submit method is {{method}}. SvelteKit dispatches actions on POST only, and a GET submit replaces the query string with the form data.'
		}
	},
	create(context) {
		/**
		 * @param {object} node the element carrying the attribute
		 * @param {object} attribute the action/formaction attribute node
		 * @param {string} label how the attribute is named in the message
		 * @param {string} method the effective submit method, lowercased
		 */
		function check(node, attribute, label, method) {
			const action = staticValue(attribute);
			// A computed action, or an empty one targeting this route's default action.
			if (action === undefined || action === '') return;
			// A computed method could be either, so the author owns the decision.
			if (method === undefined) return;

			const data = { attribute: label, action: sanitizeTerminalField(action), method };
			if (method === 'post') {
				if (!targetsFormAction(action)) {
					context.report({ node: attribute, messageId: 'unbackedFormAction', data });
				}
				return;
			}
			if (targetsFormAction(action)) {
				context.report({ node: attribute, messageId: 'formActionNeedsPost', data });
			}
		}

		/** Every descendant element, so submitters nested in wrappers are seen. */
		function* descendants(node) {
			for (const child of node.children ?? []) {
				if (!child || typeof child !== 'object') continue;
				if (child.type === 'SvelteElement') yield child;
				yield* descendants(child);
			}
		}

		return {
			SvelteElement(node) {
				if (elementName(node) !== 'form') return;

				const methodAttribute = findAttribute(node, 'method');
				const formMethod = methodAttribute ? methodOf(methodAttribute) : 'get';
				const action = findAttribute(node, 'action');
				if (action) check(node, action, 'form action', formMethod);

				// A formaction outside a form does nothing, so scanning from the form
				// is both complete and free of the parent lookups a flat visitor needs.
				for (const child of descendants(node)) {
					const formAction = findAttribute(child, 'formaction');
					if (!formAction) continue;
					const formMethodAttribute = findAttribute(child, 'formmethod');
					const submitterMethod = formMethodAttribute ? methodOf(formMethodAttribute) : formMethod;
					check(child, formAction, 'formaction', submitterMethod);
				}
			}
		};
	}
};
