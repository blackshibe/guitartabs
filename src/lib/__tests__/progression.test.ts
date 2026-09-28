import { describe, expect, it } from "vitest";
import {
	buildSlots,
	defaultProgressionFor,
	entryIndexForSection,
	locateStep,
	normalizeProgression,
	playableSteps,
	secondsAtStep,
	soundingCellsAt,
	stepOf,
} from "../progression";
import { buildTrack, poke } from "./helpers";
import { COLS_PER_MEASURE } from "../instruments";
import type { Section } from "../../types";
import { sectionRangesFor } from "../songOps";

/** Two sections over eight bars: A = 0–3, B = 4–7. */
const SECTIONS: Section[] = [
	{ id: 1, name: "A", startMeasure: 0 },
	{ id: 2, name: "B", startMeasure: 4 },
];
const RANGES = sectionRangesFor(SECTIONS, 8);

describe("normalizeProgression", () => {
	it("defaults to each section once, in timeline order", () => {
		const progression = normalizeProgression(undefined, SECTIONS);
		expect(progression.map((entry) => entry.sectionId)).toEqual([1, 2]);
	});

	it("drops steps for sections that no longer exist and clamps repeats", () => {
		const progression = normalizeProgression(
			[
				{ id: 90, sectionId: 2, repeat: 0 },
				{ id: 91, sectionId: 404, repeat: 2 },
			],
			SECTIONS,
		);
		expect(progression).toEqual([{ id: 90, sectionId: 2, repeat: 1 }]);
	});

	it("mints distinct ids for the default", () => {
		const ids = defaultProgressionFor(SECTIONS).map((entry) => entry.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe("buildSlots", () => {
	it("expands a repeat into one slot per pass, numbered and stepped", () => {
		const slots = buildSlots(RANGES, [{ id: 90, sectionId: 1, repeat: 3 }]).filter((slot) => !slot.unused);
		expect(slots).toHaveLength(3);
		expect(slots.map((slot) => slot.repeatIndex)).toEqual([0, 1, 2]);
		expect(slots.every((slot) => slot.repeatCount === 3)).toBe(true);
		// Every pass points back at the SAME source bars — nothing is copied.
		expect(slots.every((slot) => slot.startMeasure === 0 && slot.span === 4)).toBe(true);
		expect(slots.map((slot) => slot.startStep)).toEqual([0, 32, 64]);
	});

	it("plays sections in arrangement order, not timeline order", () => {
		const slots = buildSlots(RANGES, [
			{ id: 90, sectionId: 2, repeat: 1 },
			{ id: 91, sectionId: 1, repeat: 1 },
		]);
		expect(slots.map((slot) => slot.section.name)).toEqual(["B", "A"]);
		expect(slots.map((slot) => slot.startMeasure)).toEqual([4, 0]);
	});

	it("trails sections the arrangement never plays as unused slots", () => {
		const slots = buildSlots(RANGES, [{ id: 90, sectionId: 1, repeat: 2 }]);
		expect(slots.map((slot) => slot.unused)).toEqual([false, false, true]);
		expect(slots[2].section.id).toBe(2);
		// Unused bars stay editable but are past the end of playback.
		expect(playableSteps(slots)).toBe(8 * COLS_PER_MEASURE);
	});
});

describe("step addressing", () => {
	const slots = buildSlots(RANGES, [
		{ id: 90, sectionId: 1, repeat: 2 },
		{ id: 91, sectionId: 2, repeat: 1 },
	]);

	it("round-trips a position through its step", () => {
		for (const slot of slots) {
			const step = stepOf(slot, slot.startMeasure + 1, 3);
			const at = locateStep(slots, step);
			expect(at?.slot.index).toBe(slot.index);
			expect(at?.measure).toBe(slot.startMeasure + 1);
			expect(at?.column).toBe(3);
		}
	});

	it("walks off the end of a pass into the next one over the same bars", () => {
		const lastStepOfFirstPass = stepOf(slots[0], 3, COLS_PER_MEASURE - 1);
		const at = locateStep(slots, lastStepOfFirstPass + 1);
		expect(at?.slot.index).toBe(1);
		expect(at?.measure).toBe(0);
		expect(at?.column).toBe(0);
	});

	it("returns null past the last slot", () => {
		expect(locateStep(slots, 12 * COLS_PER_MEASURE)).toBeNull();
	});
});

describe("secondsAtStep", () => {
	// A (4 bars) at the song's 120bpm, B (4 bars) overridden to 60bpm.
	const overridden = sectionRangesFor(
		[
			{ id: 1, name: "A", startMeasure: 0 },
			{ id: 2, name: "B", startMeasure: 4, bpm: 60 },
		],
		8,
	);
	const slots = buildSlots(overridden, [
		{ id: 90, sectionId: 1, repeat: 1 },
		{ id: 91, sectionId: 2, repeat: 1 },
	]);

	it("collapses to step * step-duration without overrides", () => {
		expect(secondsAtStep(buildSlots(RANGES, normalizeProgression(undefined, SECTIONS)), 120, 16)).toBeCloseTo(4);
	});

	it("integrates each section's tempo override", () => {
		// A: 32 steps at 0.25s, then B at 0.5s per step.
		expect(secondsAtStep(slots, 120, 32)).toBeCloseTo(8);
		expect(secondsAtStep(slots, 120, 36)).toBeCloseTo(10);
	});

	it("extrapolates past the end at the song tempo", () => {
		expect(secondsAtStep(slots, 120, 66)).toBeCloseTo(8 + 16 + 0.5);
	});
});

describe("entryIndexForSection", () => {
	it("slots a new section in after whatever plays the section before it", () => {
		const progression = [
			{ id: 90, sectionId: 1, repeat: 1 },
			{ id: 91, sectionId: 2, repeat: 1 },
		];
		expect(entryIndexForSection(progression, SECTIONS, 2)).toBe(1);
		expect(entryIndexForSection(progression, SECTIONS, 6)).toBe(2);
		expect(entryIndexForSection(progression, SECTIONS, 0)).toBe(0);
	});
});

describe("soundingCellsAt", () => {
	const ranges = sectionRangesFor([{ id: 1, name: "A", startMeasure: 0 }], 2);
	const slots = buildSlots(ranges, [{ id: 90, sectionId: 1, repeat: 2 }]);

	it("re-strums the last chord on a strum mark over an empty column", () => {
		const track = buildTrack(10, 2);
		poke(track, 0, 0, 0, "3");
		poke(track, 0, 0, 1, "5");
		track.strums = [[null, null, "u", null, null, null, null, null]];
		expect(soundingCellsAt(slots, track, 2)).toEqual(["3", "5"]);
		expect(soundingCellsAt(slots, track, 3)).toEqual([null, null]);
	});

	it("reaches back across a repeat to the chord played before it", () => {
		const track = buildTrack(10, 2);
		poke(track, 1, 7, 0, "7");
		track.strums = [["d", null, null, null, null, null, null, null]];
		// step 16 is the second pass's first column; the first pass ended on the 7
		expect(soundingCellsAt(slots, track, 16)).toEqual(["7", null]);
		// nothing played before the very first column — it stays silent
		expect(soundingCellsAt(slots, track, 0)).toEqual([null, null]);
	});
});
