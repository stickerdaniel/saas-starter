class AdminSupportUIManager {
	detailsOpen = $state(false);

	toggle() {
		this.detailsOpen = !this.detailsOpen;
	}

	close() {
		this.detailsOpen = false;
	}
}

export const adminSupportUI = new AdminSupportUIManager();
