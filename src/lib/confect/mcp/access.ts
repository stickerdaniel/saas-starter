import * as Context from 'effect/Context';
import * as Layer from 'effect/Layer';
import * as Tool from 'effect/ai/Tool';
import type { ResourceScope } from '../oauth/resource';

export class McpPrincipal extends Context.Service<
	McpPrincipal,
	{
		readonly userId: string;
		readonly clientId: string;
		readonly scopes: readonly string[];
	}
>()('confect/mcp/access/McpPrincipal') {}

export type AccessDecision =
	| { readonly _tag: 'Allowed' }
	| { readonly _tag: 'InsufficientScope'; readonly required: readonly ResourceScope[] }
	| { readonly _tag: 'Refused' };

export class McpAccess extends Context.Service<
	McpAccess,
	{ readonly decide: (tool: Tool.Any) => AccessDecision }
>()('confect/mcp/access/McpAccess') {}

export const requiredScopes = (tool: Tool.Any): readonly ResourceScope[] =>
	Context.get(tool.annotations, Tool.Readonly) ? ['mcp:read'] : ['mcp:read', 'mcp:write'];

export const scopeAccess = Layer.effect(
	McpAccess,
	McpPrincipal.useSync((principal) => {
		const granted = new Set(principal.scopes);
		return McpAccess.of({
			decide: (tool) => {
				const required = requiredScopes(tool);
				return required.every((scope) => granted.has(scope))
					? { _tag: 'Allowed' }
					: { _tag: 'InsufficientScope', required };
			}
		});
	})
);
