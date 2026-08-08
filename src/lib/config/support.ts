/**
 * Whether the support agent answers before a human picks a thread up.
 *
 * On here, which is the template's AI-first flow: the agent replies and calls
 * `request_handoff` when it needs a human. Set it to `false` to run the widget
 * as a plain inbox instead, where every message goes straight to the team. That
 * is the shape a deployment wants when the widget exists to collect bug reports:
 * an explanation cannot fix a bug, so the model only delays the report.
 *
 * This is a build-time constant rather than an environment variable on purpose.
 * Whether a product has an AI support agent is decided once for the product, not
 * per deployment, and a value that cannot change while the app is running cannot
 * strand a thread half-way through the mode it was started in.
 *
 * Typed as `boolean` so both branches stay reachable to the compiler.
 */
const SUPPORT_AI_ENABLED: boolean = true;

export function isSupportAiEnabled(): boolean {
	return SUPPORT_AI_ENABLED;
}
