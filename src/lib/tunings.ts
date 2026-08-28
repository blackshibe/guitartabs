import type { StringTuning } from "../types";

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function noteOctaveToMidi(noteIndex: number, octave: number): number {
	return (octave + 1) * 12 + noteIndex;
}

export function midiToNoteOctave(midi: number): StringTuning {
	const octave = Math.floor(midi / 12) - 1;
	const noteIndex = ((midi % 12) + 12) % 12;
	return { noteIndex, octave };
}

export function midiToFreq(midi: number): number {
	return 440 * Math.pow(2, (midi - 69) / 12);
}

export function midiToNoteName(midi: number): string {
	const { noteIndex } = midiToNoteOctave(midi);
	return NOTE_NAMES[noteIndex];
}

// ---- tuning generator: instrument × type × root ----

export type Instrument = "Guitar" | "Bass";
export type TuningType = "Standard" | "Drop" | "Open";

// Canonical E-standard shapes, low string first, as MIDI notes.
const STANDARD_E: Record<Instrument, number[]> = {
	Guitar: [40, 45, 50, 55, 59, 64],
	Bass: [28, 33, 38, 43],
};

// Conventional open chords, low string first — the shapes differ per root
// (Open G keeps the 5th in the bass, Open C stacks roots), so they're
// authored rather than transposed from one master shape.
const OPEN_SHAPES: Record<number, number[]> = {
	0: [36, 43, 48, 55, 60, 64], // Open C: C G C G C E
	2: [38, 45, 50, 54, 57, 62], // Open D: D A D F# A D
	4: [40, 47, 52, 56, 59, 64], // Open E: E B E G# B E
	7: [38, 43, 50, 55, 59, 62], // Open G: D G D G B D
	9: [40, 45, 52, 57, 61, 64], // Open A: E A E A C# E
};

export const TUNING_TYPES: Record<Instrument, TuningType[]> = {
	Guitar: ["Standard", "Drop", "Open"],
	Bass: ["Standard", "Drop"],
};

// Roots offered per type, in display order (descending downtunes from the
// canonical root; Open is the authored set only).
export function rootsFor(type: TuningType): number[] {
	if (type === "Open") return [0, 2, 4, 7, 9];
	if (type === "Drop") return [2, 1, 0, 11, 10, 9];
	return [4, 3, 2, 1, 0, 11, 10, 9];
}

// Tuning for the pick, top string (row 0) first, as MIDI notes. Standard is
// E standard transposed down to the root; Drop X is the standard a whole
// step above X with the low string dropped two more (Drop D = E standard
// with a D bass).
export function tuningMidisFor(instrument: Instrument, type: TuningType, root: number): number[] {
	if (type === "Open") return [...(OPEN_SHAPES[root] ?? OPEN_SHAPES[2])].reverse();
	let offset = (type === "Drop" ? root + 2 : root) - 4;
	if (offset > 0) offset -= 12;
	const midis = STANDARD_E[instrument].map((m) => m + offset);
	if (type === "Drop") midis[0] -= 2;
	return midis.reverse();
}

export function presetToTuning(midiList: number[]): StringTuning[] {
	return midiList.map((midi) => midiToNoteOctave(midi));
}
