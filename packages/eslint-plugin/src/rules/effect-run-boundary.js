import { effectModule, inScope, resolveEffect, scopeSchema } from '../effect-scope.js';

const isRunner = (namespace, member) =>
	(namespace === 'Effect' && /^run[A-Z]/.test(member)) ||
	(namespace === 'ManagedRuntime' && member === 'make');

const specifierName = (node) => (node.type === 'Identifier' ? node.name : node.value);

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Allow Effect.run* and ManagedRuntime.make only in the configured runtime modules'
		},
		schema: scopeSchema,
		messages: {
			runner:
				'`{{name}}` starts a root fiber outside the runtime boundary. Return the Effect to the caller and let a runtime module from the `allow` list run it (Lifetime.run, the server or client runtime), so scheduler, services and interruption stay in one place.'
		}
	},
	create(context) {
		if (!inScope(context)) return {};
		const report = (node, namespace, member) =>
			context.report({ node, messageId: 'runner', data: { name: `${namespace}.${member}` } });
		const check = (node) => {
			const binding = resolveEffect(context, node);
			if (binding?.member && isRunner(binding.namespace, binding.member)) {
				report(node, binding.namespace, binding.member);
			}
		};
		const checkModuleSpecifiers = (node, local) => {
			const module = effectModule(node.source?.value ?? '');
			if (!module) return;
			for (const specifier of node.specifiers) {
				const member = specifierName(local(specifier));
				if (specifier.type !== 'ImportNamespaceSpecifier' && isRunner(module, member)) {
					report(specifier, module, member);
				}
			}
		};
		return {
			MemberExpression(node) {
				check(node);
			},
			ImportDeclaration(node) {
				checkModuleSpecifiers(node, (specifier) => specifier.imported ?? specifier.local);
			},
			ExportNamedDeclaration(node) {
				if (node.source) checkModuleSpecifiers(node, (specifier) => specifier.local);
			},
			ExportAllDeclaration(node) {
				const module = effectModule(node.source.value);
				if (module === 'Effect' || module === 'ManagedRuntime') {
					report(node, module, '*');
				}
			},
			VariableDeclarator(node) {
				if (node.id.type !== 'ObjectPattern' || !node.init) return;
				const binding = resolveEffect(context, node.init);
				if (!binding || binding.member) return;
				for (const property of node.id.properties) {
					if (property.type !== 'Property' || property.computed) continue;
					const member = specifierName(property.key);
					if (isRunner(binding.namespace, member)) report(property, binding.namespace, member);
				}
			}
		};
	}
};
