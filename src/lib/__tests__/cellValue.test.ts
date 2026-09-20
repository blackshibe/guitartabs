import { describe, expect, it } from "vitest";
import {
	cellMidiOffset,
	cellRingBars,
	cycleRing,
	displayCellValue,
	formatCell,
	isHarmonicValue,
	parseCellValue,
	toggleHarmonic,
	typeDigit,
} from "../cellValue";

describe("parseCellValue", () => {
	it("parses plain frets", () => {
		expect(parseCellValue("0")).toEqual({ fret: 0, harmonic: false, ringBars: 0 });
		expect(parseCellValue("17")).toEqual({ fret: 17, harmonic: false, ringBars: 0 });
	});

	it("parses harmonic frets", () => {
		expect(parseCellValue("<7>")).toEqual({ fret: 7, harmonic: true, ringBars: 0 });
		expect(parseCellValue("<12>")).toEqual({ fret: 12, harmonic: true, ringBars: 0 });
	});

	it("parses sustain, alone and alongside a harmonic", () => {
		expect(parseCellValue("5=2")).toEqual({ fret: 5, harmonic: false, ringBars: 2 });
		expect(parseCellValue("<7>=4")).toEqual({ fret: 7, harmonic: true, ringBars: 4 });
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

	it("keeps the ring length", () => {
		expect(toggleHarmonic("12=2")).toBe("<12>=2");
		expect(toggleHarmonic("<12>=2")).toBe("12=2");
	});

	it("passes garbage through", () => {
		expect(toggleHarmonic("x")).toBe("x");
	});
});

describe("sustain", () => {
	it("cycles 1 -> 2 -> 4 -> off", () => {
		expect(cycleRing("5")).toBe("5=1");
		expect(cycleRing("5=1")).toBe("5=2");
		expect(cycleRing("5=2")).toBe("5=4");
		expect(cycleRing("5=4")).toBe("5");
	});

	it("leaves empty cells alone", () => {
		expect(cycleRing(null)).toBeNull();
		expect(cycleRing("")).toBe("");
	});

	it("reads the ring length back", () => {
		expect(cellRingBars("5=2")).toBe(2);
		expect(cellRingBars("5")).toBe(0);
		expect(cellRingBars(null)).toBe(0);
	});

	it("round-trips through formatCell", () => {
		expect(formatCell({ fret: 7, harmonic: true, ringBars: 2 })).toBe("<7>=2");
		expect(formatCell({ fret: 7, harmonic: false, ringBars: 0 })).toBe("7");
	});
});

describe("typeDigit", () => {
	it("starts a new value and then extends it", () => {
		expect(typeDigit(null, "1")).toBe("1");
		expect(typeDigit("1", "2")).toBe("12");
	});

	it("restarts past two digits or fret 24", () => {
		expect(typeDigit("12", "3")).toBe("3");
		expect(typeDigit("9", "9")).toBe("9");
	});

	it("keeps the harmonic and ring flags", () => {
		expect(typeDigit("<7>=2", "1")).toBe("<1>=2"); // 71 is past the fretboard, so it restarts
		expect(typeDigit("1=1", "2")).toBe("12=1");
		expect(typeDigit("5=1", "0")).toBe("0=1"); // 50 is past the fretboard, so it restarts
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
		expect(cellMidiOffset({ fret: 9, harmonic: false, ringBars: 0 })).toBe(9);
	});

	it("maps natural-harmonic nodes to their real pitches above the open string", () => {
		expect(cellMidiOffset({ fret: 12, harmonic: true, ringBars: 0 })).toBe(12);
		expect(cellMidiOffset({ fret: 7, harmonic: true, ringBars: 0 })).toBe(19);
		expect(cellMidiOffset({ fret: 5, harmonic: true, ringBars: 0 })).toBe(24);
		expect(cellMidiOffset({ fret: 4, harmonic: true, ringBars: 0 })).toBe(28);
		expect(cellMidiOffset({ fret: 9, harmonic: true, ringBars: 0 })).toBe(28);
	});

	it("falls back to the octave for unlisted nodes", () => {
		expect(cellMidiOffset({ fret: 11, harmonic: true, ringBars: 0 })).toBe(12);
	});
});
