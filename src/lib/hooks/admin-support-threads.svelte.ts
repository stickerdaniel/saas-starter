class AdminSupportRefreshManager {
	refreshTrigger = $state(0);

	refresh() {
		this.refreshTrigger++;
	}
}

export const adminSupportRefresh = new AdminSupportRefreshManager();
