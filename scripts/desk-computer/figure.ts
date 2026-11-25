/**
 * Geometry and markup of the landing page desk computer figure. Lengths are model units on
 * the ground plane (x to the right, y toward the viewer) and z upward.
 */

import {
	boxCorners,
	cameraOf,
	coil,
	convexHull,
	corners,
	cylinder,
	depthOf,
	edgesOf,
	fitProjection,
	insetPlan,
	iso,
	pathOf,
	planOutline,
	ring,
	ringOf,
	roundedPlan,
	sideMatrix,
	slabOf,
	type Plan,
	type Point2,
	type Point3,
	type SolidPaths
} from './iso-kit';

/** A rounded rectangle cut into a front face: x and z bounds, corner radius, cut depth. */
interface Recess {
	x0: number;
	x1: number;
	z0: number;
	z1: number;
	r: number;
	depth: number;
}

const WIDTH = 600;
const HEIGHT = 440;

const PLATE: Plan = { x: -100, y: -84, w: 210, d: 242, r: 10 };
const PLATE_H = 10;
const FOOT_H = 5;

const CASE: Plan = { x: -62, y: -62, w: 124, d: 118, r: 8 };
const FRONT = CASE.y + CASE.d;
const SIDE = CASE.x + CASE.w;
const PLINTH_H = 5;
const TOP = 170;

const BEZEL: Recess = { x0: -48, x1: 48, z0: 68, z1: 158, r: 6, depth: 1.6 };
const CRT: Recess = { x0: -40, x1: 40, z0: 77, z1: 150, r: 8, depth: 5 };
const CRT_MID = (CRT.z0 + CRT.z1) / 2;
const SLOT: Recess = { x0: 8, x1: 46, z0: 45, z1: 50.5, r: 2.4, depth: 4 };

const KB: Plan = { x: -76, y: 84, w: 152, d: 58, r: 4 };
const KB_Z = 1.6;
const KB_TOP = 8.6;
const U = 9.2;
const KEYS_X = -U * 7.5;
const KEYS_Y = 88.5;

/** Keyboard rows from back to front: key cap height and key widths in key units. */
const ROWS = [
	{ height: 5.6, widths: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2] },
	{ height: 5.2, widths: [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5] },
	{ height: 4.8, widths: [1.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.25] },
	{ height: 4.4, widths: [2.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.75] },
	{ height: 4, widths: [1.5, 1.5, 9, 1.5, 1.5] }
];

const PORT = { y: 28, z: 9 };
const COIL = { x: 80, z: 3.6, r: 3.2, from: 44, to: 84, turns: 17 };
const SUN = 0.3;
const ENTER = 40;

const P = fitProjection(
	[...boxCorners(PLATE, -PLATE_H - FOOT_H, 0), ...boxCorners(CASE, 0, TOP)],
	WIDTH,
	HEIGHT,
	{ pad: 30, azimuth: 56 }
);

const HEADER = `<!--
  Desk computer figure built with anatomy (https://github.com/wheresryan22/anatomy),
  commit 689dcf966e63d92be10a5d593c6e19e10acd4422: kit/iso-kit.mjs and the geometry of
  examples/desk-computer/build.mjs.
  MIT License, Copyright (c) 2026 Ryan. See third-party-notices/anatomy-desk-computer.txt.
  Changes: every face is a filled shape and no edge is stroked; the vents, the handle recess,
  the key well, the screws and the label print are fills; the plate carries the cast shadows
  of the case and the keyboard; the CRT shows the saas-starter command mark with a smaller
  prompt and types the saas-starter CLI phrases; the glass starts lit so the server-rendered
  figure matches its first animated frame; the Enter key and the on half of the power rocker
  carry data-accent; and the figure is decorative (role and aria-label removed). Path data is
  generated; do not edit it by hand.
-->
`;

const at = (point: Point3) => iso(point, P);
const byDepth = (points: readonly Point2[]) =>
	[...points].sort((a, b) => depthOf([a[0], a[1], 0], P) - depthOf([b[0], b[1], 0], P));
const planeOf = (y: number) => sideMatrix([0, y], 0, P);

function flat(x0: number, z0: number, x1: number, z1: number, r: number, steps = 6) {
	return pathOf(
		roundedPlan({ x: x0, y: z0, w: x1 - x0, d: z1 - z0, r }, steps).map(([u, z]) => [u, -z]),
		true
	);
}

function sideSlot(y: number, z0: number, z1: number, half = 0.8) {
	return pathOf(
		roundedPlan({ x: y - half, y: z0, w: half * 2, d: z1 - z0, r: half }, 4).map(([u, z]) =>
			at([SIDE, u, z])
		),
		true
	);
}

/** Ground shadow of a solid, sheared away from the light by SUN per unit of height. */
function castOf(plan: Plan, z: number, height: number) {
	const { sinA, cosA } = cameraOf(P);
	const reach = SUN * height;
	const outline = ringOf(plan, 8);
	const points = [
		...outline,
		...outline.map(([x, y]): Point2 => [x + sinA * reach, y - cosA * reach])
	];
	return pathOf(convexHull(points.map(([x, y]) => at([x, y, z]))), true);
}

function solid(paths: SolidPaths) {
	const out = [`<path class="iso-fill" d="${paths.fill}"/>`];
	paths.shades.forEach((d, shade) => {
		if (d) out.push(`<path class="iso-shade" data-shade="${shade}" d="${d}"/>`);
	});
	out.push(`<path class="iso-top" d="${paths.top}"/>`);
	return `<g class="iso-solid">${out.join('')}</g>`;
}

function figure() {
	let clips = 0;

	function recess(
		name: string,
		{ x0, x1, z0, z1, r, depth }: Recess,
		y: number,
		backClass: string,
		back = '',
		inside = ''
	) {
		const clip = `pc-clip-${clips++}`;
		const outline = roundedPlan({ x: x0, y: z0, w: x1 - x0, d: z1 - z0, r }, 6);
		const cx = (x0 + x1) / 2;
		const cz = (z0 + z1) / 2;
		const up: string[] = [];
		const walls: string[] = [];
		for (const [[ax, az], [bx, bz]] of edgesOf(outline)) {
			const length = Math.hypot(bx - ax, bz - az) || 1;
			const [ox, oz] = [(bz - az) / length, -(bx - ax) / length];
			const flip = ox * (cx - (ax + bx) / 2) + oz * (cz - (az + bz) / 2) < 0;
			const [nx, nz] = flip ? [-ox, -oz] : [ox, oz];
			if (nx <= 0 && nz <= 0) continue;
			const quad = pathOf(
				[at([ax, y, az]), at([bx, y, bz]), at([bx, y - depth, bz]), at([ax, y - depth, az])],
				true
			);
			(nz >= nx ? up : walls).push(quad);
		}
		const shape = flat(x0, z0, x1, z1, r);
		return [
			`<clipPath id="${clip}"><path transform="${planeOf(y)}" d="${shape}"/></clipPath>`,
			`<g class="${name}" clip-path="url(#${clip})">`,
			`<g transform="${planeOf(y)}"><path class="pc-floor" d="${shape}"/></g>`,
			`<path class="pc-wall" data-face="up" d="${up.join('')}"/>`,
			`<path class="pc-wall" data-face="side" d="${walls.join('')}"/>`,
			`<g transform="${planeOf(y - depth)}"><path class="${backClass}"${backClass === 'pc-glass' ? ' data-on' : ''} d="${shape}"/>${back}</g>`,
			inside,
			`</g>`
		].join('');
	}

	function plate() {
		const out: string[] = [];
		for (const [x, y] of byDepth(corners(PLATE, 22))) {
			out.push(solid(cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28)));
			out.push(solid(cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28)));
		}
		const slab = slabOf(PLATE, -PLATE_H, PLATE_H, P, 8);
		out.push(solid(slab));
		out.push(`<clipPath id="pc-clip-plate"><path d="${slab.top}"/></clipPath>`);
		out.push(
			`<g clip-path="url(#pc-clip-plate)"><path class="pc-cast" d="${castOf(CASE, 0, TOP)}${castOf(KB, 0, KB_TOP)}"/></g>`
		);
		out.push(
			`<path class="pc-screw" d="${corners(PLATE, 10)
				.map(([x, y]) => ring(x, y, 2.2, 0, P, 16))
				.join('')}"/>`
		);
		const label: Plan = { x: -88, y: 144, w: 40, d: 9, r: 1.2 };
		out.push(solid(slabOf(label, 0, 0.8, P, 3)));
		out.push(
			`<path class="pc-print" d="${[30, 22]
				.map((w, i) =>
					planOutline({ x: label.x + 4, y: label.y + 2.4 + i * 3, w, d: 1.1, r: 0.5 }, 0.8, P, 3)
				)
				.join('')}"/>`
		);
		return out.join('');
	}

	function screen() {
		const LOGO = 'M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3';
		const logoTransform = `translate(0 ${-(CRT_MID + 11)}) scale(1.05) translate(-12 -12)`;
		const textX = CRT.x0 + 7;
		const textZ = CRT.z0 + 14;
		const sheen = pathOf(
			[
				[CRT.x0, -CRT.z1],
				[CRT.x0 + 46, -CRT.z1],
				[CRT.x0 + 14, -CRT.z0],
				[CRT.x0, -CRT.z0]
			],
			true
		);
		const back = [
			`<path class="pc-sheen" d="${sheen}"/>`,
			`<g data-part="crt" transform="">`,
			`<path class="pc-logo" transform="${logoTransform}" d="${LOGO}"/>`,
			`<text class="pc-text" data-part="text" x="${textX}" y="${-textZ}" font-size="3.8">&gt; </text>`,
			`<rect class="pc-cursor" data-part="cursor" x="${textX + 5.1}" y="${-textZ - 3.8}" width="2.7" height="4.6"/>`,
			`</g>`,
			`<path class="pc-beam" data-part="beam" d="M${CRT.x0 + 4} ${-CRT_MID}H${CRT.x1 - 4}" style="opacity:0"/>`,
			`<circle class="pc-dot" data-part="dot" cx="0" cy="${-CRT_MID}" r="1.4" style="opacity:0"/>`
		].join('');
		return recess(
			'pc-recess-bezel',
			BEZEL,
			FRONT,
			'pc-bezel',
			'',
			recess('pc-recess-crt', CRT, FRONT - BEZEL.depth, 'pc-glass', back)
		);
	}

	function rocker() {
		const y = CASE.y + 8;
		const out = [solid(slabOf({ x: SIDE, y, w: 1.2, d: 12, r: 1 }, 12, 15, P, 3))];
		const half = (z: number, proud: boolean) =>
			solid(
				slabOf({ x: SIDE + 1.2, y: y + 1.5, w: proud ? 2.4 : 0.8, d: 9, r: 0.6 }, z, 5.6, P, 2)
			);
		const onHalf = (proud: boolean) => `<g data-accent>${half(20.4, proud)}</g>`;
		out.push(`<g data-rocker="on">${half(13, true)}${onHalf(false)}</g>`);
		out.push(`<g data-rocker="off" style="display:none">${onHalf(true)}${half(13, false)}</g>`);
		return out.join('');
	}

	function port() {
		return [
			solid(slabOf({ x: SIDE - 0.4, y: PORT.y - 1, w: 1.4, d: 10, r: 1 }, PORT.z - 1, 9, P, 3)),
			solid(slabOf({ x: SIDE + 1, y: PORT.y, w: 4.4, d: 8, r: 1 }, PORT.z, 7, P, 3)),
			solid(slabOf({ x: SIDE + 5.4, y: PORT.y + 2, w: 5, d: 4, r: 1.6 }, PORT.z + 1.5, 4, P, 4))
		].join('');
	}

	function computer() {
		const out: string[] = [];
		out.push(solid(slabOf(insetPlan(CASE, 3), 0, PLINTH_H, P, 8)));
		out.push(solid(slabOf(CASE, PLINTH_H, TOP - PLINTH_H, P, 8)));
		const handle: Plan = { x: -42, y: CASE.y + 7, w: 84, d: 11, r: 5.5 };
		const groove = planOutline(handle, TOP, P, 8);
		out.push(`<clipPath id="pc-clip-groove"><path d="${groove}"/></clipPath>`);
		out.push(`<path class="pc-groove" d="${groove}"/>`);
		out.push(
			`<g clip-path="url(#pc-clip-groove)"><path class="pc-groove-floor" d="${planOutline(handle, TOP - 3, P, 8)}"/></g>`
		);
		out.push(
			`<path class="pc-vent" d="${Array.from({ length: 7 }, (_, i) =>
				planOutline({ x: -34, y: CASE.y + 27.3 + i * 3.4, w: 68, d: 1.4, r: 0.7 }, TOP, P, 4)
			).join('')}"/>`
		);
		const rowOf = (from: number, to: number) =>
			Array.from({ length: Math.floor((to - from) / 3.2 + 1e-9) + 1 }, (_, i) => from + i * 3.2);
		out.push(
			`<path class="pc-vent" d="${rowOf(CASE.y + 10, CASE.y + 52)
				.map((y) => sideSlot(y, TOP - 48, TOP - 14))
				.join('')}"/>`
		);
		out.push(
			`<path class="pc-vent" d="${rowOf(CASE.y + 10, CASE.y + 40)
				.map((y) => sideSlot(y, 20, 30))
				.join('')}"/>`
		);
		out.push(screen());
		out.push(recess('pc-recess-slot', SLOT, FRONT, 'pc-dark'));
		out.push(`<g transform="${planeOf(FRONT)}">`);
		out.push(`<circle class="pc-eject" cx="${SLOT.x1 - 2}" cy="${-(SLOT.z0 - 6)}" r="1.5"/>`);
		out.push(
			`<path class="pc-vent" d="${Array.from({ length: 9 }, (_, i) =>
				flat(-46.7 + i * 3, 42, -45.3 + i * 3, 54, 0.7, 4)
			).join('')}"/>`
		);
		out.push(`<circle class="pc-led" data-part="led" cx="-45" cy="-34" r="1.5"/>`);
		out.push(`</g>`);
		out.push(rocker());
		out.push(port());
		return `<g class="pc-computer" data-part="computer">${out.join('')}</g>`;
	}

	function keyboard() {
		const out: string[] = [];
		for (const [x, y] of byDepth(corners(KB, 8))) {
			out.push(solid(cylinder(x, y, 2.8, 0, KB_Z, P, 16)));
		}
		out.push(solid(slabOf(KB, KB_Z, KB_TOP - KB_Z, P, 6)));
		const well: Plan = {
			x: KEYS_X - 1.4,
			y: KEYS_Y - 1.4,
			w: U * 15 + 2.8,
			d: U * 5 + 2.8,
			r: 2
		};
		out.push(`<path class="pc-well" d="${planOutline(well, KB_TOP, P, 4)}"/>`);
		let index = 0;
		ROWS.forEach(({ height, widths }, r) => {
			let x = KEYS_X;
			for (const width of widths) {
				const plan: Plan = {
					x: x + 0.7,
					y: KEYS_Y + r * U + 0.7,
					w: width * U - 1.4,
					d: U - 1.4,
					r: 1.4
				};
				out.push(
					`<g class="pc-key" data-key="${index}"${index === ENTER ? ' data-accent' : ''}>${solid(slabOf(plan, KB_TOP, height, P, 3))}</g>`
				);
				index++;
				x += width * U;
			}
		});
		out.push(solid(slabOf({ x: KB.x + KB.w, y: 90, w: 4, d: 4, r: 1.5 }, 2.5, 4, P, 4)));
		return out.join('');
	}

	function cable() {
		const curve = (points: readonly Point3[]) => pathOf(points.map((point) => at(point)));
		const start: Point3 = [COIL.x + COIL.r, COIL.from, COIL.z];
		const end: Point3 = [COIL.x + COIL.r, COIL.to, COIL.z];
		const spring = coil(COIL.from, COIL.to, [COIL.x, COIL.z], COIL.r, COIL.turns, 'y', P);
		return [
			`<path class="pc-cord" d="${curve([
				[SIDE + 10.4, PORT.y + 4, PORT.z + 3.5],
				[SIDE + 14, PORT.y + 6, PORT.z + 2.4],
				[SIDE + 17, PORT.y + 9.5, PORT.z - 1],
				[SIDE + 19.6, PORT.y + 13, COIL.z + 1.6],
				start
			])}"/>`,
			`<path class="pc-cord" data-side="back" d="${spring.back}"/>`,
			`<path class="pc-cord" d="${spring.front}"/>`,
			`<path class="pc-cord" d="${curve([
				end,
				[COIL.x + 2.6, COIL.to + 3, COIL.z + 0.2],
				[KB.x + KB.w + 6.4, 91.4, 4.4],
				[KB.x + KB.w + 4, 92, 4.5]
			])}"/>`
		].join('');
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg" viewBox="0 0 ${WIDTH} ${HEIGHT}">${plate()}${computer()}${keyboard()}${cable()}</svg>`;
}

/** The complete content of src/lib/components/desk-computer/desk-computer.svg. */
export function renderDeskComputerSvg(): string {
	return `${HEADER}${figure()}\n`;
}
