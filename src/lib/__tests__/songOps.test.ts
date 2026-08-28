import { describe, expect, it } from "vitest";
import {
	dedupeSections,
	deepCopyMeasures,
	deleteMeasuresFromTrack,
	insertBlankMeasures,
	insertMeasuresIntoTrack,
	measureIsEmpty,
	measuresEqual,
	sectionRangesFor,
} from "../songOps";
import { makeMeasure, makeMeasures } from "../instruments";
import { buildTrack, poke } from "./helpers";

describe("sectionRangesFor", () => {
	it("derives end measures from the next section's start", () => {
		const ranges = sectionRangesFor(
			[
				{ id: 2, name: "B", startMeasure: 4 },
				{ id: 1, name: "A", startMeasure: 0 },
			],
			8,
		);
		expect(ranges.map((range) => [range.id, range.startMeasure, range.endMeasure])).toEqual([
			[1, 0, 3],
			[2, 4, 7],
		]);
	});

	it("gives the last section everything to the end", () => {
		const ranges = sectionRangesFor([{ id: 1, name: "A", startMeasure: 0 }], 12);
		expect(ranges[0].endMeasure).toBe(11);
	});
});

describe("dedupeSections", () => {
	it("drops later sections sharing a startMeasure", () => {
		const result = dedupeSections([
			{ id: 1, name: "A", startMeasure: 0 },
			{ id: 2, name: "B", startMeasure: 0 },
			{ id: 3, name: "C", startMeasure: 2 },
		]);
		expect(result.map((section) => section.id)).toEqual([1, 3]);
	});
});

describe("deepCopyMeasures", () => {
	it("copies deeply enough that cell writes don't leak back", () => {
		const original = makeMeasures(2, 1);
		const copy = deepCopyMeasures(original);
		copy[0][0][0] = "9";
		expect(original[0][0][0]).toBeNull();
	});
});

describe("timeline splices", () => {
	it("insertMeasuresIntoTrack splices at the requested index", () => {
		const track = buildTrack(1, 2);
		poke(track, 1, 0, 0, "5");
		const grown = insertMeasuresIntoTrack(track, 1, makeMeasures(2, 2));
		expect(grown.measures).toHaveLength(4);
		expect(grown.measures[3][0][0]).toBe("5");
	});

	it("insertBlankMeasures matches the track's string count", () => {
		const track = buildTrack(1, 1);
		const grown = insertBlankMeasures(track, 0, 1);
		expect(grown.measures[0].every((column) => column.length === 2)).toBe(true);
	});

	it("deleteMeasuresFromTrack drops exactly the given indices", () => {
		const track = buildTrack(1, 4);
		poke(track, 3, 0, 0, "8");
		const shrunk = deleteMeasuresFromTrack(track, new Set([0, 2]));
		expect(shrunk.measures).toHaveLength(2);
		expect(shrunk.measures[1][0][0]).toBe("8");
	});
});

describe("measuresEqual / measureIsEmpty", () => {
	it("treats empty string and null as the same cell value", () => {
		const a = makeMeasure(1);
		const b = makeMeasure(1);
		a[0][0] = "";
		expect(measuresEqual(a, b)).toBe(true);
	});

	it("detects differing values", () => {
		const a = makeMeasure(1);
		const b = makeMeasure(1);
		b[3][0] = "7";
		expect(measuresEqual(a, b)).toBe(false);
	});

	it("handles undefined operands", () => {
		const a = makeMeasure(1);
		expect(measuresEqual(undefined, undefined)).toBe(true);
		expect(measuresEqual(a, undefined)).toBe(false);
	});

	it("measureIsEmpty ignores empty strings and accepts undefined", () => {
		const measure = makeMeasure(1);
		expect(measureIsEmpty(measure)).toBe(true);
		measure[0][0] = "";
		expect(measureIsEmpty(measure)).toBe(true);
		measure[0][0] = "0";
		expect(measureIsEmpty(measure)).toBe(false);
		expect(measureIsEmpty(undefined)).toBe(true);
	});
});
