import { fromJsonSchema, McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import * as Cause from 'effect/Cause';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as FiberSet from 'effect/FiberSet';
import * as Option from 'effect/Option';
import * as Record from 'effect/Record';
import * as Result from 'effect/Result';
import type * as Schema from 'effect/Schema';
import * as Stream from 'effect/Stream';
import * as Tool from 'effect/ai/Tool';
import * as Toolkit from 'effect/ai/Toolkit';
import { Forbidden, Invalid, NotFound, RateLimited, Unauthenticated } from '../../effect/errors';
import { CommunityRefusal } from '../errorCodecs';
import { McpAccess } from './access';

export const INTERNAL_ERROR_TEXT = 'Internal error';

type DeclaredFailure =
	CommunityRefusal | Forbidden | Invalid | NotFound | RateLimited | Unauthenticated;

export const toolErrorText = (error: DeclaredFailure): string => {
	switch (error._tag) {
		case 'CommunityRefusal':
			return `The message is longer than ${error.maxLength} characters.`;
		case 'Forbidden':
			return `Not allowed (${error.code}).`;
		case 'Invalid':
			return `Invalid request (${error.code}).`;
		case 'NotFound':
			return `Not found (${error.code}).`;
		case 'RateLimited':
			return `Rate limited. Retry in ${Math.ceil(error.retryAfter / 1000)} s.`;
		case 'Unauthenticated':
			return 'The connected account is no longer available.';
	}
};

const isDeclaredFailure = (error: unknown): error is DeclaredFailure =>
	error instanceof CommunityRefusal ||
	error instanceof Forbidden ||
	error instanceof Invalid ||
	error instanceof NotFound ||
	error instanceof RateLimited ||
	error instanceof Unauthenticated;

const errorResult = (text: string): CallToolResult => ({
	isError: true,
	content: [{ type: 'text', text }]
});

const successResult = (value: unknown): CallToolResult => ({
	content: [{ type: 'text', text: JSON.stringify(value) ?? 'null' }],
	...(value !== null && typeof value === 'object' && !Array.isArray(value)
		? { structuredContent: Object.fromEntries(Object.entries(value)) }
		: {})
});

const classify = (name: string) => (cause: Cause.Cause<unknown>) => {
	const failure = Cause.findFail(cause);
	if (!Cause.hasDies(cause) && Result.isSuccess(failure)) {
		const origin = Context.get(Cause.reasonAnnotations(failure.success), Toolkit.FailureOrigin);
		const error = failure.success.error;
		if (origin === 'handler' && isDeclaredFailure(error)) {
			return Effect.succeed(errorResult(toolErrorText(error)));
		}
		if (origin === 'parameters') {
			return Effect.succeed(errorResult(`Invalid arguments for tool ${name}.`));
		}
	}
	return Effect.logError('mcp tool call failed', cause).pipe(
		Effect.as(errorResult(INTERNAL_ERROR_TEXT))
	);
};

const callTool = <Tools extends Record<string, Tool.Any>>(
	built: Toolkit.WithHandler<Tools>,
	name: keyof Tools & string,
	args: Schema.Json
) =>
	built.handle(name, args).pipe(
		Effect.flatMap((results) =>
			Stream.runLast(Stream.filter(results, (result) => !result.preliminary))
		),
		Effect.flatMap(
			Option.match({
				onNone: () => Effect.die(new Error(`tool ${name} produced no final result`)),
				onSome: (result) =>
					result.isFailure
						? Effect.die(result.result)
						: Effect.succeed(successResult(result.encodedResult))
			})
		),
		Effect.catchCause(classify(name))
	);

const outputSchemaOf = (tool: Tool.Any) => {
	const schema = Tool.getJsonSchemaFromSchema(tool.successSchema);
	return schema.type === 'object' ? fromJsonSchema(schema) : undefined;
};

export const toolkitServerFactory = <Tools extends Record<string, Tool.Any>>(
	toolkit: Toolkit.Toolkit<Tools>,
	info: { readonly name: string; readonly title: string; readonly version: string }
) =>
	Effect.gen(function* () {
		const built = yield* toolkit;
		const access = yield* McpAccess;
		const run = yield* FiberSet.makeRuntimePromise<Tool.HandlerServices<Tools[keyof Tools]>>();
		const visible = Record.toEntries(toolkit.tools).filter(
			([, tool]) => access.decide(tool)._tag === 'Allowed'
		);
		return () => {
			const server = new McpServer(info, { capabilities: { tools: {} } });
			for (const [name, tool] of visible) {
				const title = Context.getOrUndefined(tool.annotations, Tool.Title);
				const outputSchema = outputSchemaOf(tool);
				server.registerTool(
					name,
					{
						...(title === undefined ? {} : { title }),
						description: Tool.getDescription(tool),
						inputSchema: fromJsonSchema<Schema.Json>(Tool.getJsonSchema(tool)),
						...(outputSchema === undefined ? {} : { outputSchema }),
						annotations: {
							...(title === undefined ? {} : { title }),
							readOnlyHint: Context.get(tool.annotations, Tool.Readonly),
							destructiveHint: Context.get(tool.annotations, Tool.Destructive),
							idempotentHint: Context.get(tool.annotations, Tool.Idempotent),
							openWorldHint: Context.get(tool.annotations, Tool.OpenWorld)
						}
					},
					(args) => run(callTool(built, name, args))
				);
			}
			return server;
		};
	});
