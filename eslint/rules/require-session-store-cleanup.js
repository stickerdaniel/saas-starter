const BETTER_AUTH = /^better-auth(\/|$)/;
const SESSION_MEMBERS = new Set(['useSession', '$store']);

function isBetterAuthImport(node) {
	const expression = node?.type === 'AwaitExpression' ? node.argument : node;
	return (
		expression?.type === 'ImportExpression' &&
		typeof expression.source.value === 'string' &&
		BETTER_AUTH.test(expression.source.value)
	);
}

function patternBinding(pattern, key) {
	if (pattern?.type !== 'ObjectPattern') return undefined;
	for (const property of pattern.properties) {
		if (property.type !== 'Property' || property.computed) continue;
		if (property.key.type !== 'Identifier' || property.key.name !== key) continue;
		if (property.value.type === 'Identifier') return property.value.name;
	}
	return undefined;
}

function memberName(node) {
	if (node.computed) return node.property.type === 'Literal' ? node.property.value : undefined;
	return node.property.type === 'Identifier' ? node.property.name : undefined;
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Require cleanStores in a test file that reads the session store of a Better Auth client it creates'
		},
		schema: [],
		messages: {
			missingCleanup:
				'Unmount the session store before the file ends, with `cleanStores(client.useSession())` in `afterAll` or `onTestFinished`, because the store cleanup runs one second after the last unsubscribe.'
		}
	},
	create(context) {
		const creators = new Set();
		const cleaners = new Set();
		const calls = [];
		let readsSession = false;
		return {
			ImportDeclaration(node) {
				const source = node.source.value;
				for (const specifier of node.specifiers) {
					if (specifier.type !== 'ImportSpecifier') continue;
					const imported = specifier.imported.name ?? specifier.imported.value;
					if (imported === 'createAuthClient' && BETTER_AUTH.test(source)) {
						creators.add(specifier.local.name);
					}
					if (imported === 'cleanStores' && source === 'nanostores') {
						cleaners.add(specifier.local.name);
					}
				}
			},
			VariableDeclarator(node) {
				if (!isBetterAuthImport(node.init)) return;
				const local = patternBinding(node.id, 'createAuthClient');
				if (local) creators.add(local);
			},
			MemberExpression(node) {
				if (SESSION_MEMBERS.has(memberName(node))) readsSession = true;
			},
			CallExpression(node) {
				if (node.callee.type === 'Identifier') calls.push(node);
			},
			'Program:exit'() {
				if (!readsSession || calls.some((call) => cleaners.has(call.callee.name))) return;
				const creation = calls.find((call) => creators.has(call.callee.name));
				if (creation) context.report({ node: creation, messageId: 'missingCleanup' });
			}
		};
	}
};
