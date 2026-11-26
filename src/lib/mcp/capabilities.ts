export type CapabilityLevel = 'view' | 'change';

export const CAPABILITIES = [
	{ tool: 'get_account', level: 'view' },
	{ tool: 'list_community_messages', level: 'view' },
	{ tool: 'post_community_message', level: 'change' }
] as const satisfies ReadonlyArray<{ tool: string; level: CapabilityLevel }>;

export type Capability = (typeof CAPABILITIES)[number];

export const capabilitiesAt = (level: CapabilityLevel): Capability[] =>
	CAPABILITIES.filter((capability) => capability.level === level);

export const capabilityKey = (capability: Capability) => `mcp.capability.${capability.tool}`;
