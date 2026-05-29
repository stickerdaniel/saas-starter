import type { UIMessage } from '@convex-dev/agent';

/** Capabilities the app needs from a chat model, one column per check. */
export type Capability = 'catalog' | 'text' | 'reasoning' | 'image' | 'pdf' | 'tools';

export const CAPABILITIES: Capability[] = ['catalog', 'text', 'reasoning', 'image', 'pdf', 'tools'];

export type VerdictStatus = 'pass' | 'fail' | 'warn' | 'skip';

export type Verdict = {
	capability: Capability;
	status: VerdictStatus;
	notes: string[];
	/** Wall-clock of the underlying probe call, when one was made. */
	ms: number | null;
};

/** Capability flags advertised by the OpenRouter catalog for a model. */
export type CatalogInfo = {
	id: string;
	name: string;
	inputModalities: string[];
	supportedParameters: string[];
	hasTools: boolean;
	hasReasoning: boolean;
	hasImage: boolean;
	hasFile: boolean;
};

/**
 * An assistant turn after it has gone through the app's own materialization
 * pipeline, so reasoning/tool parts are in the exact shape the chat UI renders.
 */
export type MaterializedAssistant = {
	uiMessage: UIMessage;
	displayText: string;
	displayReasoning: string;
	parts: UIMessage['parts'];
};

export type ModelReport = {
	model: string;
	catalog: CatalogInfo | null;
	verdicts: Verdict[];
	/** Set when the whole model run failed before any probe (e.g. bad key). */
	error: string | null;
};
