/**
 * Whether the support agent answers before a human picks a thread up.
 *
 * On by default, which is the template's AI-first flow: the agent replies and
 * calls `request_handoff` when it needs a human. `SUPPORT_AI_ENABLED=false`
 * turns the widget into a plain inbox instead, where threads are created
 * already handed off and every message goes straight to the team. That is the
 * shape a deployment wants when the widget exists to collect bug reports: an
 * explanation cannot fix a bug, so the model only delays the report.
 *
 * Read through `process.env` rather than the generated `env` object so the mode
 * can be flipped per deployment without a code change.
 */
export function isSupportAiEnabled(): boolean {
	return process.env.SUPPORT_AI_ENABLED !== 'false';
}
