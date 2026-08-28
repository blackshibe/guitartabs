import { describe, expect, it } from "vitest";
import {
	COLS_PER_MEASURE,
	advanceIdCounter,
	chunkMeasures,
	defaultTuning,
	makeMeasure,
	makeTrack,
	nextId,
	stringMidi,
	tuningLabel,
} from "../instruments";

describe("grid factories", () => {
	it("makeMeasure builds 8 columns of nulls per string", () => {
		const measure = makeMeasure(3);
		expect(measure).toHaveLength(COLS_PER_MEASURE);
		expect(measure.every((column) => column.length === 3 && column.every((value) => value === null))).toBe(true);
	});

	it("makeTrack builds the requested measure count", () => {
		const track = makeTrack("Guitar", defaultTuning(), 5);
		expect(track.measures).toHaveLength(5);
		expect(track.tuning).toHaveLength(6);
		expect(track.name).toBe("Guitar");
	});
});

describe("chunkMeasures", () => {
	it("wraps at 4 per line by default", () => {
		expect(chunkMeasures([0, 1, 2, 3, 4, 5])).toEqual([
			[0, 1, 2, 3],
			[4, 5],
		]);
	});

	it("honors a custom chunk size", () => {
		expect(chunkMeasures([0, 1, 2], 2)).toEqual([[0, 1], [2]]);
	});

	it("handles empty input", () => {
		expect(chunkMeasures([])).toEqual([]);
	});
});

describe("tuningLabel", () => {
	it("prints low string first even though row 0 is the top string", () => {
		expect(tuningLabel(defaultTuning())).toBe("E A D G B E");
	});
});

describe("stringMidi", () => {
	it("matches the default tuning's top string (high E)", () => {
		expect(stringMidi(defaultTuning()[0])).toBe(64);
	});
});

describe("id counter", () => {
	it("only ever moves forward", () => {
		const first = nextId();
		advanceIdCounter(first - 10); // no-op
		expect(nextId()).toBe(first + 1);
		advanceIdCounter(first + 100);
		expect(nextId()).toBe(first + 101);
	});
});
