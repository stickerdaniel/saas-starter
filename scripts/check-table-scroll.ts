import assert from 'node:assert/strict';
import { expect, type Page } from '@playwright/test';
import { operationTimeout, runFixtureCheck } from './fixture-browser.ts';

const tolerance = 2;

// Inspect the effective scroll owner, not a particular wrapper or utility class.
function geometry() {
	const table = document.querySelector('table');
	const header = table?.tHead;
	const firstRow = table?.tBodies[0]?.rows[0];
	const lastRow = table?.tBodies[0]?.rows[table.tBodies[0].rows.length - 1];
	if (!table || !header || !firstRow || !lastRow) throw new Error('Table is not ready');
	let viewport = table.parentElement;
	while (viewport?.parentElement) {
		if (
			/(auto|scroll)/.test(getComputedStyle(viewport).overflowY) &&
			viewport.scrollHeight > viewport.clientHeight + 2
		)
			break;
		viewport = viewport.parentElement;
	}
	if (!viewport) throw new Error('Table has no scroll viewport');
	const rect = (element: Element) => {
		const { top, bottom, left, right, width, height } = element.getBoundingClientRect();
		return { top, bottom, left, right, width, height };
	};
	return {
		header: rect(header),
		viewport: rect(viewport),
		firstRow: rect(firstRow),
		lastRow: rect(lastRow),
		scrollTop: viewport.scrollTop,
		columns: Array.from(header.querySelectorAll('th'), (head, index) => ({
			header: rect(head),
			cell: rect(firstRow.cells[index]!)
		}))
	};
}

async function check(page: Page) {
	await page.getByRole('button', { name: 'Review 24', exact: true }).waitFor();
	await page.evaluate(() => document.fonts.ready.then(() => undefined));
	const initial = await page.evaluate(geometry);
	await page.mouse.move(initial.viewport.left + 100, initial.viewport.top + 100);
	await page.mouse.wheel(0, 240);
	await expect
		.poll(async () => initial.firstRow.top - (await page.evaluate(geometry)).firstRow.top, {
			message: 'Scrolling the table must bring different rows into view',
			timeout: operationTimeout
		})
		.toBeGreaterThan(150);
	const scrolled = await page.evaluate(geometry);
	console.log('Vertical scroll:', JSON.stringify({ initial, scrolled }));
	assert(
		scrolled.header.top >= scrolled.viewport.top - tolerance &&
			scrolled.header.bottom <= scrolled.viewport.bottom + tolerance,
		'The header must stay visible while rows scroll; bound the actual table scroll owner, not its outer shell'
	);
	assert(
		Math.abs(scrolled.header.top - initial.header.top) <= tolerance,
		'The header must stay in place while different rows move into view'
	);

	await page.getByRole('table').evaluate((table) => {
		let viewport = table.parentElement;
		while (viewport) {
			if (
				/(auto|scroll)/.test(getComputedStyle(viewport).overflowX) &&
				viewport.scrollWidth > viewport.clientWidth
			) {
				viewport.scrollLeft = viewport.scrollWidth;
				break;
			}
			viewport = viewport.parentElement;
		}
	});
	const horizontal = await page.evaluate(geometry);
	const finalColumn = horizontal.columns.at(-1)!;
	assert(
		finalColumn.header.right <= horizontal.viewport.right + tolerance &&
			finalColumn.header.left >= horizontal.viewport.left - tolerance,
		'Horizontal scrolling must expose the final column'
	);
	for (const column of horizontal.columns) {
		assert(
			Math.abs(column.header.left - column.cell.left) <= tolerance &&
				Math.abs(column.header.width - column.cell.width) <= tolerance,
			'Header and body columns must remain aligned during horizontal scrolling'
		);
	}

	const panel = await page.getByRole('region', { name: 'Table scroll contract' }).boundingBox();
	const next = page.getByRole('button', { name: 'Go to next page' });
	const pagination = await next.boundingBox();
	assert(
		panel &&
			pagination &&
			pagination.y >= horizontal.viewport.bottom - tolerance &&
			pagination.y + pagination.height <= panel.y + panel.height + tolerance,
		'Pagination must remain outside the row scroller and inside the short panel; keep the entire flex chain shrinkable'
	);
	await next.click();
	await expect(next).toBeDisabled();

	await page.getByRole('button', { name: 'Review 24', exact: true }).focus();
	for (let index = 0; index < 23; index++) {
		await page.keyboard.press('Shift+Tab');
		const focus = await page.evaluate(() => {
			const active = document.activeElement;
			const header = document.querySelector('thead');
			if (!active?.closest('tbody') || !header)
				throw new Error('Reverse-tab must enter a row control');
			return {
				name: active.textContent,
				top: active.getBoundingClientRect().top,
				headerBottom: header.getBoundingClientRect().bottom
			};
		});
		assert(
			focus.top >= focus.headerBottom + tolerance,
			`Reverse-tab must reveal ${focus.name} below the rendered header with focus-ring clearance: ${JSON.stringify(focus)}`
		);
	}
	console.log(
		'PASS: moving rows, sticky header, aligned horizontal access, reachable pagination and unobscured reverse-tab focus'
	);
}

// The admin pages render the table in unbounded page flow, where no parent height bounds
// it: only the scroller's own maximum height keeps the rows scrolling under the header.
async function checkPageFlow(page: Page) {
	await page.getByRole('button', { name: 'Review 24', exact: true }).waitFor();
	await page.evaluate(() => document.fonts.ready.then(() => undefined));
	const measure = () =>
		page.evaluate(() => {
			const table = document.querySelector('table');
			const header = table?.tHead;
			const firstRow = table?.tBodies[0]?.rows[0];
			let scroller = table?.parentElement;
			while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY))
				scroller = scroller.parentElement;
			if (!header || !firstRow || !scroller) throw new Error('Table has no vertical scroller');
			const { top, bottom } = header.getBoundingClientRect();
			const box = scroller.getBoundingClientRect();
			return {
				header: { top, bottom },
				firstRowTop: firstRow.getBoundingClientRect().top,
				scroller: { left: box.left, top: box.top, bottom: box.bottom, height: box.height },
				rowsHeight: scroller.scrollHeight,
				viewportHeight: window.innerHeight
			};
		});
	const initial = await measure();
	await page.mouse.move(initial.scroller.left + 100, initial.scroller.top + 100);
	await page.mouse.wheel(0, 240);
	await expect
		.poll(async () => initial.firstRowTop - (await measure()).firstRowTop, {
			message: 'Scrolling over the table in page flow must bring different rows into view',
			timeout: operationTimeout
		})
		.toBeGreaterThan(150);
	const scrolled = await measure();
	console.log('Page flow scroll:', JSON.stringify({ initial, scrolled }));
	assert(
		scrolled.header.top >= -tolerance &&
			scrolled.header.bottom <= scrolled.viewportHeight + tolerance &&
			Math.abs(scrolled.header.top - initial.header.top) <= tolerance,
		`In page flow the header must stay in place inside the viewport while rows scroll; give the table scroller its own maximum height: ${JSON.stringify({ initial: initial.header, scrolled: scrolled.header })}`
	);
	assert(
		scrolled.scroller.height < scrolled.viewportHeight &&
			scrolled.rowsHeight > scrolled.scroller.height + tolerance,
		`In page flow the table scroller must stay shorter than the viewport and its rows instead of growing with them: ${JSON.stringify({ scroller: scrolled.scroller.height, rows: scrolled.rowsHeight, viewport: scrolled.viewportHeight })}`
	);
	const next = page.getByRole('button', { name: 'Go to next page' });
	const pagination = await next.boundingBox();
	assert(
		pagination &&
			pagination.y >= scrolled.scroller.bottom - tolerance &&
			pagination.y + pagination.height <= scrolled.viewportHeight + tolerance,
		'In page flow pagination must sit below the table scroller and inside the viewport'
	);
	await next.click();
	await expect(next).toBeDisabled();
	console.log(
		'PASS: page flow keeps the header in view, the scroller bounded and pagination reachable'
	);
}

await runFixtureCheck({
	label: 'Table scroll check',
	fixture: 'src/lib/components/tables/test-fixtures/TableScrollHarness.svelte',
	run: async (page, origin) => {
		await page.goto(origin);
		await check(page);
		await page.goto(`${origin}/?layout=page`);
		await checkPageFlow(page);
	}
});
