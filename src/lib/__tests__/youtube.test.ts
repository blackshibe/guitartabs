import { describe, expect, it } from "vitest";
import { extractVideoId, videoSecondsForCol } from "../youtube";

describe("extractVideoId", () => {
	it("parses every supported URL form", () => {
		const id = "dQw4w9WgXcQ";
		expect(extractVideoId(`https://www.youtube.com/watch?v=${id}`)).toBe(id);
		expect(extractVideoId(`https://youtu.be/${id}`)).toBe(id);
		expect(extractVideoId(`https://www.youtube.com/embed/${id}`)).toBe(id);
		expect(extractVideoId(`https://www.youtube.com/shorts/${id}`)).toBe(id);
		expect(extractVideoId(`  ${id}  `)).toBe(id);
	});

	it("rejects garbage", () => {
		expect(extractVideoId("https://example.com/watch?v=nope")).toBeNull();
		expect(extractVideoId("hello world")).toBeNull();
		expect(extractVideoId("")).toBeNull();
	});
});

describe("videoSecondsForCol", () => {
	const anchor = { anchorMeasure: 2, anchorSeconds: 30 };

	it("returns the anchor time at the anchor downbeat", () => {
		expect(videoSecondsForCol(anchor, 120, 8, 16)).toBe(30);
	});

	it("advances by seconds-per-column past the anchor", () => {
		// 120 bpm → 0.25s per 8th-note column.
		expect(videoSecondsForCol(anchor, 120, 8, 20)).toBeCloseTo(31);
	});

	it("walks backwards before the anchor but clamps at zero", () => {
		expect(videoSecondsForCol(anchor, 120, 8, 12)).toBeCloseTo(29);
		expect(videoSecondsForCol({ anchorMeasure: 0, anchorSeconds: 1 }, 120, 8, 100)).toBeGreaterThan(0);
		expect(videoSecondsForCol({ anchorMeasure: 10, anchorSeconds: 0 }, 120, 8, 0)).toBe(0);
	});
});
