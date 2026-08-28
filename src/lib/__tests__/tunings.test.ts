import { describe, expect, it } from "vitest";
import {
	midiToFreq,
	midiToNoteName,
	midiToNoteOctave,
	noteOctaveToMidi,
	presetToTuning,
	rootsFor,
	tuningMidisFor,
} from "../tunings";

describe("midi conversions", () => {
	it("round-trips note/octave through midi", () => {
		for (let midi = 12; midi <= 108; midi++) {
			const { noteIndex, octave } = midiToNoteOctave(midi);
			expect(noteOctaveToMidi(noteIndex, octave)).toBe(midi);
		}
	});

	it("maps the guitar anchors", () => {
		expect(noteOctaveToMidi(4, 2)).toBe(40); // E2, low E
		expect(noteOctaveToMidi(4, 4)).toBe(64); // E4, high E
	});

	it("computes A440 and octaves", () => {
		expect(midiToFreq(69)).toBeCloseTo(440);
		expect(midiToFreq(81)).toBeCloseTo(880);
		expect(midiToFreq(57)).toBeCloseTo(220);
	});

	it("names notes", () => {
		expect(midiToNoteName(40)).toBe("E");
		expect(midiToNoteName(61)).toBe("C#");
	});
});

describe("tuningMidisFor", () => {
	it("returns guitar E standard, top string first", () => {
		expect(tuningMidisFor("Guitar", "Standard", 4)).toEqual([64, 59, 55, 50, 45, 40]);
	});

	it("transposes standard down to the root", () => {
		// D standard = E standard down a whole step.
		expect(tuningMidisFor("Guitar", "Standard", 2)).toEqual([62, 57, 53, 48, 43, 38]);
	});

	it("builds Drop D as E standard with a dropped low string", () => {
		const dropD = tuningMidisFor("Guitar", "Drop", 2);
		expect(dropD).toEqual([64, 59, 55, 50, 45, 38]);
	});

	it("returns authored open shapes reversed to top-first", () => {
		// Open G: D G D G B D low→high, so top-first ends on the low D.
		const openG = tuningMidisFor("Guitar", "Open", 7);
		expect(openG[openG.length - 1]).toBe(38);
		expect(openG).toHaveLength(6);
	});

	it("covers bass standard", () => {
		expect(tuningMidisFor("Bass", "Standard", 4)).toEqual([43, 38, 33, 28]);
	});

	it("never transposes upward past the canonical root", () => {
		for (const root of rootsFor("Standard")) {
			const midis = tuningMidisFor("Guitar", "Standard", root);
			expect(midis[0]).toBeLessThanOrEqual(64);
		}
	});
});

describe("rootsFor / presetToTuning", () => {
	it("offers the authored open roots only", () => {
		expect(rootsFor("Open")).toEqual([0, 2, 4, 7, 9]);
	});

	it("presetToTuning mirrors midiToNoteOctave", () => {
		expect(presetToTuning([64, 40])).toEqual([
			{ noteIndex: 4, octave: 4 },
			{ noteIndex: 4, octave: 2 },
		]);
	});
});
