/** Agent metadata is deliberately unknown in the vendor UIMessage contract. */
function isMetadataRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeMessageMetadata(value: unknown): Record<string, unknown> | undefined {
	return isMetadataRecord(value) ? value : undefined;
}

/** Decode only the provider fields this UI owns; never assert nested provider payloads. */
export function getMessageProviderFlags(value: unknown): {
	isAdminMessage: boolean;
	systemNotice: string | undefined;
} {
	const metadata = normalizeMessageMetadata(value);
	const provider = normalizeMessageMetadata(metadata?.providerMetadata);
	const admin = normalizeMessageMetadata(provider?.admin);
	const system = normalizeMessageMetadata(provider?.system);
	return {
		isAdminMessage: metadata?.provider === 'human' || admin?.isAdminMessage === true,
		systemNotice: typeof system?.notice === 'string' ? system.notice : undefined
	};
}
