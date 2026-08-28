import type { Column, Measure, StringTuning, Track } from "../types";
import { NOTE_NAMES, noteOctaveToMidi, presetToTuning, tuningMidisFor } from "./tunings";

export const COLS_PER_MEASURE = 8;
export const MEASURES_PER_LINE = 4;

export function chunkMeasures(measureIndices: number[], size = MEASURES_PER_LINE): number[][] {
	const chunks: number[][] = [];
	for (let i = 0; i < measureIndices.length; i += size) {
		chunks.push(measureIndices.slice(i, i + size));
	}
	return chunks;
}

export function makeColumn(stringCount: number): Column {
	return Array(stringCount).fill(null);
}

export function makeMeasure(stringCount: number): Measure {
	return Array.from({ length: COLS_PER_MEASURE }, () => makeColumn(stringCount));
}

export function makeMeasures(stringCount: number, count: number): Measure[] {
	return Array.from({ length: count }, () => makeMeasure(stringCount));
}

// E standard guitar — the default everywhere a track is created.
export function defaultTuning(): StringTuning[] {
	return presetToTuning(tuningMidisFor("Guitar", "Standard", 4));
}

// tuning: array of { noteIndex, octave }, row 0 = top string as drawn.
export function tuningLabel(tuning: StringTuning[]): string {
	// Row 0 is the top drawn string (highest pitch); tuning names read low→high.
	return tuning
		.slice()
		.reverse()
		.map((s) => NOTE_NAMES[s.noteIndex])
		.join(" ");
}

export function stringMidi(s: StringTuning): number {
	return noteOctaveToMidi(s.noteIndex, s.octave);
}

let idCounter = 1;
export function nextId(): number {
	idCounter += 1;
	return idCounter;
}

export function advanceIdCounter(atLeast: number): void {
	if (atLeast > idCounter) idCounter = atLeast;
}

export function makeTrack(name: string, tuning: StringTuning[], measureCount: number): Track {
	return {
		id: nextId(),
		name,
		tuning,
		measures: makeMeasures(tuning.length, measureCount),
	};
}
