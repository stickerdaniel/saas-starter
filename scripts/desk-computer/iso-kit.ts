/**
 * Isometric projection and solid extrusion for the desk computer figure.
 *
 * Typed subset of kit/iso-kit.mjs from https://github.com/wheresryan22/anatomy at commit
 * 689dcf966e63d92be10a5d593c6e19e10acd4422, reduced to the parts the figure draws with.
 * `pathOf` differs from the kit: it writes each point as its step from the one before.
 *
 * MIT License, Copyright (c) 2026 Ryan
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { required } from '../required';

export type Point2 = readonly [number, number];
export type Point3 = readonly [number, number, number];

/** A rounded rectangle on the ground plane: corner at (x, y), width w, depth d, radius r. */
export interface Plan {
	x: number;
	y: number;
	w: number;
	d: number;
	r: number;
}

export interface Projection {
	origin: Point2;
	scale: number;
	azimuth: number;
	elevation: number;
}

/** Screen paths of one extruded solid; shades holds the visible side faces by light bucket. */
export interface SolidPaths {
	fill: string;
	top: string;
	shades: string[];
}

const AZIMUTH = 45;
const ELEVATION = 30;
const SHADES = 4;
const RADIANS = Math.PI / 180;
const UNIT = Math.sqrt(1.6);

export function cameraOf({ scale, azimuth, elevation }: Projection) {
	const a = azimuth * RADIANS;
	const e = elevation * RADIANS;
	return {
		sinA: Math.sin(a),
		cosA: Math.cos(a),
		sinE: Math.sin(e),
		cosE: Math.cos(e),
		k: scale * UNIT
	};
}

export function iso([x, y, z]: Point3, projection: Projection): Point2 {
	const { origin } = projection;
	const { sinA, cosA, sinE, cosE, k } = cameraOf(projection);
	return [
		origin[0] + (x * sinA - y * cosA) * k,
		origin[1] + ((x * cosA + y * sinA) * sinE - z * cosE) * k
	];
}

export function depthOf([x, y, z]: Point3, projection: Projection): number {
	const { sinA, cosA, sinE, cosE } = cameraOf(projection);
	return (x * cosA + y * sinA) * cosE + z * sinE;
}

/** A count of tenths as the shortest path number: no leading zero and no trailing `.0`. */
function tenths(count: number): string {
	const sign = count < 0 ? '-' : '';
	const whole = Math.trunc(Math.abs(count) / 10);
	const fraction = Math.abs(count) % 10;
	return fraction ? `${sign}${whole || ''}.${fraction}` : `${sign}${whole}`;
}

/**
 * Path data through the points, each rounded to a tenth. The first point is absolute and
 * every later one is its step from the point before, so equal shapes in different places
 * share their text. A sign or a second decimal point already ends the number before it,
 * and only where neither does a space separates two numbers.
 */
export function pathOf(points: readonly Point2[], closed = false): string {
	const [start, ...rest] = points.map(([x, y]): readonly [number, number] => [
		Math.round(x * 10),
		Math.round(y * 10)
	]);
	if (!start) return '';
	let d = '';
	let command = '';
	let last = '';
	const write = (next: string, values: readonly number[]) => {
		if (next !== command) {
			d += next;
			command = next;
			last = '';
		}
		for (const value of values) {
			const text = tenths(value);
			const ends = text.startsWith('-') || (text.startsWith('.') && last.includes('.'));
			d += last && !ends ? ` ${text}` : text;
			last = text;
		}
	};
	write('M', start);
	let at = start;
	for (const point of rest) {
		const dx = point[0] - at[0];
		const dy = point[1] - at[1];
		at = point;
		if (dx && dy) write('l', [dx, dy]);
		else if (dx) write('h', [dx]);
		else if (dy) write('v', [dy]);
	}
	// Points that all round to the start still draw the dot a round line cap gives them.
	if (rest.length && command === 'M') write('h', [0]);
	return closed ? `${d}z` : d;
}

/** Each point paired with its successor, wrapping the last point back to the first. */
export function edgesOf(ring: readonly Point2[]): Array<readonly [Point2, Point2]> {
	return ring.map((point, index): readonly [Point2, Point2] => [
		point,
		required(ring[(index + 1) % ring.length], 'next ring point')
	]);
}

export function roundedPlan({ x, y, w, d, r }: Plan, steps = 8): Point2[] {
	const radius = Math.max(0, Math.min(r, w / 2, d / 2));
	const corners: Array<readonly [cx: number, cy: number, start: number]> = [
		[x + w - radius, y + radius, -90],
		[x + w - radius, y + d - radius, 0],
		[x + radius, y + d - radius, 90],
		[x + radius, y + radius, 180]
	];
	const out: Point2[] = [];
	for (const [cx, cy, start] of corners) {
		const count = radius > 0 ? steps : 0;
		for (let step = 0; step <= count; step++) {
			const angle = (start + (count ? (90 * step) / count : 45)) * RADIANS;
			out.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
		}
	}
	return out;
}

export const ringOf = (plan: Plan, steps = 8): Point2[] => roundedPlan(plan, steps);

function signedArea(points: readonly Point2[]): number {
	let area = 0;
	for (const [[ax, ay], [bx, by]] of edgesOf(points)) area += ax * by - bx * ay;
	return area / 2;
}

const oriented = (points: readonly Point2[]): readonly Point2[] =>
	signedArea(points) < 0 ? [...points].reverse() : points;

function cross(o: Point2, a: Point2, b: Point2): number {
	return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function bendsInward(chain: readonly Point2[], point: Point2): boolean {
	const last = chain.at(-1);
	const before = chain.at(-2);
	return last !== undefined && before !== undefined && cross(before, last, point) <= 0;
}

function halfHull(sorted: readonly Point2[]): Point2[] {
	const chain: Point2[] = [];
	for (const point of sorted) {
		while (bendsInward(chain, point)) chain.pop();
		chain.push(point);
	}
	return chain.slice(0, -1);
}

/** Monotone-chain hull; collinear points are dropped. */
export function convexHull(points: readonly Point2[]): Point2[] {
	const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	if (sorted.length < 3) return sorted;
	return [...halfHull(sorted), ...halfHull([...sorted].reverse())];
}

function extrude(
	ring: readonly Point2[],
	z: number,
	height: number,
	projection: Projection
): SolidPaths {
	const counter = signedArea(ring) > 0;
	const { sinA, cosA } = cameraOf(projection);
	const lift = ([x, y]: Point2, at: number) => iso([x, y, at], projection);
	const sides = edgesOf(ring).flatMap(([a, b]) => {
		const dx = b[0] - a[0];
		const dy = b[1] - a[1];
		const length = Math.hypot(dx, dy) || 1;
		const [nx, ny] = counter ? [dy / length, -dx / length] : [-dy / length, dx / length];
		if (height <= 0 || nx * cosA + ny * sinA <= 1e-9) return [];
		const lit = (nx * -sinA + ny * cosA + 1) / 2;
		const quad = [lift(a, z + height), lift(b, z + height), lift(b, z), lift(a, z)];
		return [
			{
				shade: Math.min(SHADES - 1, Math.max(0, Math.floor(lit * SHADES))),
				d: pathOf(oriented(quad), true)
			}
		];
	});
	const top = ring.map((point) => lift(point, z + height));
	const bottom = ring.map((point) => lift(point, z));
	return {
		fill: pathOf(convexHull([...top, ...bottom]), true),
		top: pathOf(oriented(top), true),
		shades: Array.from({ length: SHADES }, (_, shade) =>
			sides
				.filter((side) => side.shade === shade)
				.map((side) => side.d)
				.join('')
		)
	};
}

export function slabOf(
	plan: Plan,
	z: number,
	height: number,
	projection: Projection,
	steps = 8
): SolidPaths {
	return extrude(ringOf(plan, steps), z, height, projection);
}

function circleRing(cx: number, cy: number, radius: number, steps = 40): Point2[] {
	return Array.from({ length: steps }, (_, step): Point2 => {
		const angle = (step / steps) * Math.PI * 2;
		return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
	});
}

export function cylinder(
	cx: number,
	cy: number,
	radius: number,
	z: number,
	height: number,
	projection: Projection,
	steps = 32
): SolidPaths {
	return extrude(circleRing(cx, cy, radius, steps), z, height, projection);
}

export const insetPlan = ({ x, y, w, d, r }: Plan, by: number): Plan => ({
	x: x + by,
	y: y + by,
	w: w - by * 2,
	d: d - by * 2,
	r: Math.max(0, r - by)
});

function onTop(points: readonly Point2[], z: number, projection: Projection, closed = false) {
	return pathOf(
		points.map(([x, y]) => iso([x, y, z], projection)),
		closed
	);
}

export const planOutline = (plan: Plan, z: number, projection: Projection, steps = 8): string =>
	onTop(ringOf(plan, steps), z, projection, true);

export const ring = (
	cx: number,
	cy: number,
	radius: number,
	z: number,
	projection: Projection,
	steps = 40
): string => onTop(circleRing(cx, cy, radius, steps), z, projection, true);

export function corners({ x, y, w, d }: Plan, inset = 0): Point2[] {
	return [
		[x + inset, y + inset],
		[x + w - inset, y + inset],
		[x + inset, y + d - inset],
		[x + w - inset, y + d - inset]
	];
}

export function boxCorners({ x, y, w, d }: Plan, z0: number, z1: number): Point3[] {
	const out: Point3[] = [];
	for (const px of [x, x + w])
		for (const py of [y, y + d]) for (const z of [z0, z1]) out.push([px, py, z]);
	return out;
}

/**
 * A helix around an axis parallel to x or y, split into the strokes on the viewer's side
 * (front) and the strokes behind the axis (back).
 */
export function coil(
	from: number,
	to: number,
	center: Point2,
	radius: number,
	turns: number,
	axis: 'x' | 'y',
	projection: Projection,
	perTurn = 16
): { back: string; front: string } {
	const count = Math.max(1, Math.round(turns * perTurn));
	const back: string[] = [];
	const front: string[] = [];
	let run: Point2[] = [];
	let near: boolean | null = null;
	for (let index = 0; index <= count; index++) {
		const share = index / count;
		const angle = share * turns * Math.PI * 2;
		const u = radius * Math.cos(angle);
		const v = radius * Math.sin(angle);
		const along = from + (to - from) * share;
		const point: Point3 =
			axis === 'x' ? [along, center[0] + u, center[1] + v] : [center[0] + u, along, center[1] + v];
		const normal: Point3 =
			axis === 'x' ? [0, Math.cos(angle), Math.sin(angle)] : [Math.cos(angle), 0, Math.sin(angle)];
		const facing = depthOf(normal, projection) > 0;
		const flat = iso(point, projection);
		near ??= facing;
		run.push(flat);
		if (facing !== near) {
			(near ? front : back).push(pathOf(run));
			run = [flat];
			near = facing;
		}
	}
	if (run.length > 1) (near ? front : back).push(pathOf(run));
	return { back: back.join(''), front: front.join('') };
}

const thousandth = (value: number) => Math.round(value * 1000) / 1000;

const matrixOf = (u: Point2, v: Point2, origin: Point2) =>
	`matrix(${thousandth(u[0])} ${thousandth(u[1])} ${thousandth(v[0])} ${thousandth(v[1])} ${thousandth(origin[0])} ${thousandth(origin[1])})`;

/**
 * SVG transform that maps 2D coordinates onto the vertical plane through (x, y) parallel to
 * the x axis: u runs along x, v runs downward.
 */
export function sideMatrix([x, y]: Point2, z: number, projection: Projection): string {
	const origin = iso([x, y, z], projection);
	const along = (point: Point3): Point2 => {
		const [px, py] = iso(point, projection);
		return [px - origin[0], py - origin[1]];
	};
	const [upX, upY] = along([x, y, z + 1]);
	return matrixOf(along([x + 1, y, z]), [-upX, -upY], origin);
}

/** The projection that fits every point into a width by height canvas with pad on each side. */
export function fitProjection(
	points: readonly Point3[],
	width: number,
	height: number,
	{ pad = 24, azimuth = AZIMUTH, elevation = ELEVATION } = {}
): Projection {
	const unit: Projection = { origin: [0, 0], scale: 1, azimuth, elevation };
	const flat = points.map((point) => iso(point, unit));
	const xs = flat.map(([x]) => x);
	const ys = flat.map(([, y]) => y);
	const left = Math.min(...xs);
	const right = Math.max(...xs);
	const up = Math.min(...ys);
	const down = Math.max(...ys);
	const scale = Math.min((width - pad * 2) / (right - left), (height - pad * 2) / (down - up));
	return {
		origin: [width / 2 - ((left + right) / 2) * scale, height / 2 - ((up + down) / 2) * scale],
		scale,
		azimuth,
		elevation
	};
}
