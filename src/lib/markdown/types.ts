export interface MarkdownLink {
	label: string;
	href: string;
	description?: string;
}

export interface MarketingMarkdownSection {
	heading: string;
	paragraphs?: string[];
	bullets?: string[];
	links?: MarkdownLink[];
}

export interface MarketingMarkdownDocument {
	title: string;
	description: string;
	canonicalPath?: string;
	robots?: string;
	sections: MarketingMarkdownSection[];
}

export interface MarketingMarkdownRenderContext {
	origin: string;
	pathname: string;
	lang: string;
}
