declare module 'virtual:marketing-fonts/server' {
	const font: Record<'home' | 'public', { css: string; href: string }> | null;
	export default font;
}
