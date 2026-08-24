export function shouldShowMarketingAuthControls(input: {
	ssrAuthenticated: boolean;
	ssrHasSession: boolean;
	sessionChecked: boolean;
	authLoading: boolean;
}): boolean {
	return (
		input.ssrAuthenticated || !input.ssrHasSession || (input.sessionChecked && !input.authLoading)
	);
}
