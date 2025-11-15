# AI Customer Support Integration

This document explains how the AI-powered customer support chat is integrated into the SaaS Starter project using the Convex Agent component.

## Overview

The customer support system uses the **Convex Agent** component to provide AI-powered chat conversations with:

- **Real-time streaming** - Responses stream word-by-word for a natural feel
- **Persistent threads** - Conversations are saved and can be continued across sessions
- **Context awareness** - AI maintains conversation history and semantic search
- **Optimistic UI** - Messages appear instantly with smooth animations

## Architecture

### Backend (Convex)

**Agent Configuration** (`src/lib/convex/support/agent.ts`):

- Uses GLM 4.5 Air (via OpenRouter) for chat responses - FREE
- Uses recent message history for context (no embeddings required)
- System instructions define the support agent's behavior and knowledge

**Thread Management** (`src/lib/convex/support/threads.ts`):

- `createThread` - Initialize new support conversation
- `getThread` - Retrieve thread metadata
- `updateThread` - Update title/summary
- `listUserThreads` - Get all threads for a user
- `deleteThread` - Remove thread and messages

**Message Handling** (`src/lib/convex/support/messages.ts`):

- `sendMessage` - Save user message and trigger AI response
- `generateResponse` - Internal action that streams AI response
- `listMessages` - Query messages with streaming support
- `getMessageStream` - Get streaming state for real-time updates

### Frontend (Svelte)

**Context Management** (`support-thread-context.svelte.ts`):

- `SupportThreadContext` class manages thread state
- Shared via runed's Context API across components
- Tracks messages, streaming state, loading, and errors

**Smooth Text Animation** (`utils/smooth-text.svelte.ts`):

- `createSmoothText` utility for character-by-character reveal
- Provides smooth streaming effect without React dependencies

**Components**:

- `customer-support.svelte` - Main orchestrator, initializes thread
- `feedback-widget.svelte` - Chat interface with message history
- `ai-chatbar.svelte` - Floating input pill for quick questions

**Convex Integration Pattern**:
This project uses `convex-svelte` which provides:

- `useQuery()` - Reactive queries with automatic updates
- `useConvexClient()` - Client for calling mutations and actions
- **Note**: Unlike React, there's no `useMutation()` hook. Use `client.mutation()` instead.

## Database Tables

The agent component automatically creates these tables:

- `agent:threads` - Conversation threads with metadata
- `agent:messages` - Messages within threads
- `agent:streamingDeltas` - Real-time streaming chunks
- `agent:embeddings` - Vector embeddings for semantic search

## Setup Instructions

### 1. Install Dependencies

Already installed:

```bash
bun add @convex-dev/agent @openrouter/ai-sdk-provider ai
```

### 2. Set OpenRouter API Key

Get your API key from https://openrouter.ai/settings/keys

**Free tier includes:**

- DeepSeek V3.1 - Unlimited & free (671B parameters)
- Gemini 2.0 Flash - Free tier available
- Grok 2 - Free tier available
- Many other free models

**Important:** Use the `:free` suffix in model IDs to access free tier (e.g., `deepseek/deepseek-chat-v3.1:free`)

Set it in your Convex deployment:

```bash
bunx convex env set OPENROUTER_API_KEY sk-or-v1-your_api_key_here
```

For production:

```bash
bunx convex env set OPENROUTER_API_KEY sk-or-v1-your_api_key_here --prod
```

### 3. Deploy Convex Functions

The agent component is already registered in `convex.config.ts`. Deploy your functions:

```bash
bunx convex dev
```

The agent tables will be created automatically on first deployment.

### 4. Test the Integration

1. Start your dev server: `bun run dev`
2. Open the application in your browser
3. Click the feedback button or use the AI chatbar
4. Send a message and watch the AI response stream in

## Features

### Real-time Streaming

Messages stream word-by-word using Convex's reactive database:

1. User sends message → saved to `agent:messages`
2. Internal action generates AI response with `saveStreamDeltas: true`
3. Streaming chunks saved to `agent:streamingDeltas`
4. Convex reactivity pushes updates to all connected clients
5. UI displays smooth character-by-character animation

### Conversation Context

The agent automatically maintains context using:

- **Recent messages** - Last 20 messages in the current thread

Configured in `src/lib/convex/support/agent.ts`:

```typescript
contextOptions: {
	recentMessages: 20;
}
```

### Optimistic Updates

For instant feedback:

1. User message appears immediately (optimistic)
2. Mutation sent to Convex
3. Real message replaces optimistic one
4. AI response starts streaming

### Session Persistence

Threads are stored in `sessionStorage`:

- Same thread across page refreshes
- New thread when browser session ends
- Future: Link to user accounts for permanent history

## Customization

### Modify Agent Behavior

Edit `src/lib/convex/support/agent.ts`:

```typescript
instructions: `Your custom instructions here...`;
```

### Add Tools

Give the agent additional capabilities:

```typescript
import { createTool } from '@convex-dev/agent';

const searchDocs = createTool({
	description: 'Search documentation',
	args: z.object({
		query: z.string()
	}),
	handler: async (ctx, args) => {
		// Search implementation
		return results;
	}
});

export const supportAgent = new Agent(components.agent, {
	tools: {
		searchDocs
	}
});
```

### Change Models

Use different OpenRouter models (many are free):

```typescript
import { openrouter } from '@openrouter/ai-sdk-provider';

// FREE models
languageModel: openrouter('z-ai/glm-4.5-air:free'), // GLM 4.5 Air (default)
languageModel: openrouter('moonshotai/kimi-k2:free'), // Kimi K2
languageModel: openrouter('x-ai/grok-4-fast'), // Fast & free
languageModel: openrouter('deepseek/deepseek-chat-v3.1:free'), // Unlimited & free
languageModel: openrouter('google/gemini-2.0-flash-exp:free'), // Very fast
languageModel: openrouter('meta-llama/llama-3.3-70b-instruct:free'), // Strong open model
languageModel: openrouter('qwen/qwen-2.5-72b-instruct:free'), // Good multilingual

// Premium models (paid)
languageModel: openrouter('anthropic/claude-3.5-sonnet'), // Highest quality
languageModel: openrouter('openai/gpt-4o'), // OpenAI via OpenRouter
```

**Note:** Vector embeddings are not currently used. The agent relies on recent message history for context.

### Adjust Streaming Speed

Modify chunking and throttle in `messages.ts`:

```typescript
saveStreamDeltas: {
  chunking: 'char',   // 'char', 'word', or 'sentence'
  throttleMs: 100     // Milliseconds between updates
}
```

## Usage Tracking

The agent supports usage tracking for billing:

```typescript
const supportAgent = new Agent(components.agent, {
	usageHandler: async (ctx, usage) => {
		// Track tokens used
		await ctx.runMutation(internal.billing.trackUsage, {
			userId: usage.userId,
			tokens: usage.usage.totalTokens,
			cost: calculateCost(usage)
		});
	}
});
```

## Rate Limiting

Prevent abuse with Convex's rate limiter component:

```typescript
import { RateLimiter } from '@convex-dev/rate-limiter';

const limiter = new RateLimiter(components.rateLimiter);

export const sendMessage = mutation({
	handler: async (ctx, args) => {
		const { ok } = await limiter.limit(ctx, {
			key: userId,
			config: { kind: 'token bucket', rate: 10, period: 60_000 }
		});

		if (!ok) throw new Error('Rate limited');

		// ... send message
	}
});
```

## Troubleshooting

### Messages not streaming

1. Check OpenRouter API key is set: `bunx convex env list`
2. Verify Convex is running: `bunx convex dev`
3. Check browser console for errors
4. Ensure `saveStreamDeltas: true` in `generateResponse` action
5. Verify model is available: Check https://openrouter.ai/models for model status

### "Thread not found" errors

1. Clear sessionStorage: `sessionStorage.clear()`
2. Refresh page to create new thread
3. Check thread ID exists in database

### Slow responses

1. Use faster model: Try `x-ai/grok-4-fast`, `google/gemini-2.0-flash-exp:free`, or `deepseek/deepseek-chat-v3.1:free`
2. Reduce context: Lower `recentMessages` in `contextOptions`
3. Increase throttle: Set `throttleMs` higher for fewer database writes
4. Check model status: Some free models may have rate limits during peak times

### UI not updating

1. Ensure query is reactive (using `useQuery`)
2. Check `$effect` dependencies
3. Verify Convex subscription is active

## Next Steps

**Potential enhancements**:

1. **User authentication** - Link threads to user accounts
2. **File attachments** - Already have screenshot support, add to messages
3. **Feedback buttons** - Thumbs up/down on AI responses
4. **Conversation summaries** - Auto-generate thread titles
5. **Handoff to human** - Escalate to support team
6. **Multi-language** - Use Tolgee for i18n support
7. **Voice input** - Add speech-to-text
8. **Analytics** - Track common questions and response quality

## Resources

- [Convex Agent Documentation](https://github.com/get-convex/agent)
- [Vercel AI SDK](https://sdk.vercel.ai/docs)
- [OpenRouter Documentation](https://openrouter.ai/docs)
- [OpenRouter Models](https://openrouter.ai/models) - See available free and paid models
- [Runed Context API](https://runed.dev/docs/utilities/context)
