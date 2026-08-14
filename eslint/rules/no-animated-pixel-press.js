/**
 * ESLint rule: no-animated-pixel-press
 *
 * One-pixel press offsets are tactile state changes. Animating them makes the
 * control lag behind the pointer. This rule checks static Tailwind classes on
 * Svelte class attributes, including literals split across cn() arguments, and
 * the base classes of tailwind-variants definitions.
 *
 * Component class props need an explicit safe transition because their classes
 * are merged with defaults the call site cannot see. Native elements without a
 * transition are already safe.
 *
 * ❌ <button class="transition-all active:translate-y-px">
 * ❌ <Widget class="active:translate-y-px">
 * ✅ <button class="transition-colors active:translate-y-px">
 * ✅ <Widget class="transition-colors active:translate-y-px">
 * ✅ <button class="transition-transform active:scale-[0.97]">
 */

const CLASS_FACTORY_NAMES = new Set(['cva', 'tv']);

function walk(node, visit) {
	if (!node || typeof node !== 'object') return;
	visit(node);
	for (const [key, value] of Object.entries(node)) {
		if (key === 'parent') continue;
		if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
		else if (value && typeof value === 'object' && value.type) walk(value, visit);
	}
}

function staticClassTokens(node) {
	const tokens = [];
	walk(node, (candidate) => {
		let value;
		if (
			(candidate.type === 'Literal' || candidate.type === 'SvelteLiteral') &&
			typeof candidate.value === 'string'
		) {
			value = candidate.value;
		} else if (candidate.type === 'TemplateElement') {
			value = candidate.value?.cooked ?? candidate.value?.raw;
		}
		if (value) tokens.push(...value.split(/\s+/u).filter(Boolean));
	});
	return tokens;
}

function isPixelPress(token) {
	const isPressVariant =
		/(?:^|:)active:/u.test(token) ||
		/(?:^|:)(?:group|peer)-active(?:\/[^:]+)?:/u.test(token) ||
		/:active\]/u.test(token);
	return isPressVariant && /(?:^|:)!?-?translate-[xy]-px!?$/u.test(token);
}

function isUnsafeTransition(token) {
	const animatesMovement =
		/(?:^|:)!?transition(?:-(?:all|transform)|-\[[^\]]*(?:all|transform|translate)[^\]]*\])?!?$/u.test(
			token
		);
	const hasUnknownProperties =
		/(?:^|:)!?transition-(?:\[[^\]]*(?:var\(|--)[^\]]*\]|\(--[^)]*\))!?$/u.test(token);
	return animatesMovement || hasUnknownProperties;
}

function isExplicitSafeTransition(token) {
	if (!/^!?transition(?:-|$)/u.test(token)) return false;
	return !isUnsafeTransition(token);
}

function isComponentClassAttribute(node) {
	const element = node.parent?.parent;
	const name = element?.name;
	if (!name) return element?.type === 'SvelteComponent';
	if (name.type === 'SvelteMemberExpressionName') return true;
	return name.type === 'Identifier' && /^[A-Z]/u.test(name.name ?? '');
}

function propertyName(property) {
	if (!property || property.type !== 'Property' || property.computed) return null;
	if (property.key?.type === 'Identifier') return property.key.name;
	return typeof property.key?.value === 'string' ? property.key.value : null;
}

function classFactoryBase(call) {
	if (call.callee?.type !== 'Identifier' || !CLASS_FACTORY_NAMES.has(call.callee.name)) return null;
	const first = call.arguments?.[0];
	if (!first) return null;
	if (call.callee.name === 'cva' && first.type !== 'ObjectExpression') return first;
	if (first.type !== 'ObjectExpression') return null;
	return first.properties.find((property) => propertyName(property) === 'base')?.value ?? null;
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Keep one-pixel press translations out of transform transitions'
		},
		schema: [],
		messages: {
			animatedPixelPress:
				'One-pixel press translation must be immediate. Restrict the transition to non-movement properties such as transition-colors.',
			unprovenComponentPress:
				'Component classes may inherit a movement transition. Add an explicit non-movement transition such as transition-colors beside the one-pixel press.'
		}
	},
	create(context) {
		function check(node, { component = false } = {}) {
			const tokens = staticClassTokens(node);
			if (!tokens.some(isPixelPress)) return;
			if (tokens.some(isUnsafeTransition)) {
				context.report({ node, messageId: 'animatedPixelPress' });
				return;
			}
			if (component && !tokens.some(isExplicitSafeTransition)) {
				context.report({ node, messageId: 'unprovenComponentPress' });
			}
		}

		return {
			SvelteAttribute(node) {
				if (node.key?.name !== 'class') return;
				check(node, { component: isComponentClassAttribute(node) });
			},
			Property(node) {
				if (propertyName(node) === 'class') check(node.value);
			},
			CallExpression(node) {
				const base = classFactoryBase(node);
				if (base) check(base);
			}
		};
	}
};
