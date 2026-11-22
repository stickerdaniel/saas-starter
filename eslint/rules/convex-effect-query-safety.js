import { resolveEffect } from 'eslint-plugin-saas-starter/effect-scope';
import { findDefinition, specKind, walk } from '../confect-spec-kinds.js';
import { CUSTOM_REGISTRARS, RAW_REGISTRARS } from '../convex-registrars.js';

const TRANSACTIONAL_BUILDERS = new Set(
	[...RAW_REGISTRARS, ...CUSTOM_REGISTRARS].filter((name) => /(query|mutation)$/i.test(name))
);
const TRANSACTIONAL_SPEC = /(Query|Mutation)$/;
const HELPERS = [
	{ name: 'withRetry', module: /(^|\/)effect\/retry(\.[jt]s)?$/ },
	{ name: 'within', module: /(^|\/)effect\/timeout(\.[jt]s)?$/ }
];

const isFunction = (node) =>
	node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression';

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Forbid timers, schedules, deferred forks and retries in Convex query and mutation handlers'
		},
		schema: [],
		messages: {
			timer:
				'Remove `{{name}}` from this query or mutation handler. Confect runs queries and mutations on a synchronous scheduler without timers, so a sleep, timeout, schedule, deferred fork or retry cannot complete inside the transaction. Put a durable delay or retry on `ctx.scheduler`, a cron or Workpool, or move the work into an action.'
		}
	},
	create(context) {
		function forbidden(node) {
			if (node.type === 'Identifier') {
				const definition = findDefinition(context, node);
				if (definition?.type === 'ImportBinding' && definition.node.type === 'ImportSpecifier') {
					const imported = definition.node.imported.name ?? definition.node.imported.value;
					const source = definition.parent.source.value;
					const helper = HELPERS.find(
						({ name, module }) => name === imported && module.test(source)
					);
					if (helper) return helper.name;
				}
			}
			if (node.type !== 'Identifier' && node.type !== 'MemberExpression') return null;
			const binding = resolveEffect(context, node);
			if (!binding) return null;
			if (binding.namespace === 'Schedule') {
				return binding.member ? `Schedule.${binding.member}` : null;
			}
			if (binding.namespace !== 'Effect' || !binding.member) return null;
			const { member } = binding;
			if (member === 'sleep' || member.startsWith('timeout')) return `Effect.${member}`;
			if (!member.startsWith('fork')) return null;
			const call =
				node.parent?.type === 'CallExpression' && node.parent.callee === node ? node.parent : null;
			const immediate = call?.arguments.some(
				(argument) =>
					argument.type === 'ObjectExpression' &&
					argument.properties.some(
						(property) =>
							property.type === 'Property' &&
							!property.computed &&
							property.key.type === 'Identifier' &&
							property.key.name === 'startImmediately' &&
							property.value.type === 'Literal' &&
							property.value.value === true
					)
			);
			return immediate ? null : `Effect.${member}`;
		}

		function checkHandler(handler) {
			walk(handler, (node) => {
				if (
					node.type === 'MemberExpression' &&
					node.parent?.type === 'MemberExpression' &&
					node.parent.object === node
				) {
					return;
				}
				if (node.type === 'Identifier' && node.parent?.type === 'MemberExpression') {
					if (node.parent.object === node || node.parent.property === node) return;
				}
				const name = forbidden(node);
				if (name) context.report({ node, messageId: 'timer', data: { name } });
			});
		}

		function isFunctionImplMake(call) {
			const { callee } = call;
			if (
				callee.type !== 'MemberExpression' ||
				callee.computed ||
				callee.object.type !== 'Identifier' ||
				callee.property.type !== 'Identifier' ||
				callee.property.name !== 'make'
			) {
				return false;
			}
			const definition = findDefinition(context, callee.object);
			return (
				definition?.type === 'ImportBinding' &&
				definition.parent.source.value === '@confect/server' &&
				definition.node.type === 'ImportSpecifier' &&
				(definition.node.imported.name ?? definition.node.imported.value) === 'FunctionImpl'
			);
		}

		return {
			CallExpression(node) {
				if (node.callee.type === 'Identifier' && TRANSACTIONAL_BUILDERS.has(node.callee.name)) {
					const [config] = node.arguments;
					const handler =
						config?.type === 'ObjectExpression' &&
						config.properties.find(
							(property) =>
								property.type === 'Property' &&
								!property.computed &&
								property.key.type === 'Identifier' &&
								property.key.name === 'handler'
						);
					if (handler && isFunction(handler.value)) checkHandler(handler.value);
					return;
				}
				if (!isFunctionImplMake(node)) return;
				const [, group, name, implementation] = node.arguments;
				if (!isFunction(implementation)) return;
				const kind = specKind(context, group, name);
				if (kind === undefined || TRANSACTIONAL_SPEC.test(kind)) checkHandler(implementation);
			}
		};
	}
};
