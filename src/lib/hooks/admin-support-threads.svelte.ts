class AdminSupportRefreshManager {
	refreshTrigger = $state(0);
	loaderResetTrigger = $state(0);

	refresh() {
		this.refreshTrigger++;
	}

	resetLoaders() {
		this.loaderResetTrigger++;
	}
}

export const adminSupportRefresh = new AdminSupportRefreshManager();
