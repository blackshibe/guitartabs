import { describe, expect, it } from "vitest";
import { cellMidiOffset, displayCellValue, isHarmonicValue, parseCellValue, toggleHarmonic } from "../harmonics";

describe("parseCellValue", () => {
	it("parses plain frets", () => {
		expect(parseCellValue("0")).toEqual({ fret: 0, harmonic: false });
		expect(parseCellValue("17")).toEqual({ fret: 17, harmonic: false });
	});

	it("parses harmonic frets", () => {
		expect(parseCellValue("<7>")).toEqual({ fret: 7, harmonic: true });
		expect(parseCellValue("<12>")).toEqual({ fret: 12, harmonic: true });
	});

	it("returns null for empty and garbage", () => {
		expect(parseCellValue(null)).toBeNull();
		expect(parseCellValue("")).toBeNull();
		expect(parseCellValue("x")).toBeNull();
		expect(parseCellValue("<x>")).toBeNull();
	});
});

describe("toggleHarmonic", () => {
	it("wraps and unwraps", () => {
		expect(toggleHarmonic("12")).toBe("<12>");
		expect(toggleHarmonic("<12>")).toBe("12");
	});

	it("passes garbage through", () => {
		expect(toggleHarmonic("x")).toBe("x");
	});
});

describe("displayCellValue / isHarmonicValue", () => {
	it("shows harmonics with the diamond and plain frets as-is", () => {
		expect(displayCellValue("<7>")).toBe("◇7");
		expect(displayCellValue("7")).toBe("7");
	});

	it("detects harmonic values", () => {
		expect(isHarmonicValue("<5>")).toBe(true);
		expect(isHarmonicValue("5")).toBe(false);
		expect(isHarmonicValue(null)).toBe(false);
	});
});

describe("cellMidiOffset", () => {
	it("uses the fret itself for normal notes", () => {
		expect(cellMidiOffset({ fret: 9, harmonic: false })).toBe(9);
	});

	it("maps natural-harmonic nodes to their real pitches above the open string", () => {
		expect(cellMidiOffset({ fret: 12, harmonic: true })).toBe(12);
		expect(cellMidiOffset({ fret: 7, harmonic: true })).toBe(19);
		expect(cellMidiOffset({ fret: 5, harmonic: true })).toBe(24);
		expect(cellMidiOffset({ fret: 4, harmonic: true })).toBe(28);
		expect(cellMidiOffset({ fret: 9, harmonic: true })).toBe(28);
	});

	it("falls back to the octave for unlisted nodes", () => {
		expect(cellMidiOffset({ fret: 11, harmonic: true })).toBe(12);
	});
});
