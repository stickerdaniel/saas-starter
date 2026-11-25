export const FOUNDER_INCIDENT_REFUSALS = {
	invalidExpectedRevision: 'Invalid founder incident expected revision',
	revisionConflict: 'Founder incident draft revision conflict',
	frozenDraft: 'Founder incident draft is frozen after processing',
	unknownDraft: 'Unknown founder incident draft',
	approvalMismatch: 'Founder incident approval no longer matches; preview again',
	invalidContent: 'Invalid founder incident email content',
	unknownKey: 'Unknown founder incident key'
} as const;
