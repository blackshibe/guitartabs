import type { Measure, Section, SectionRange, Track } from "../types";
import { makeMeasures } from "./instruments";

export function sectionRangesFor(sections: Section[], measureCount: number): SectionRange[] {
	const sorted = [...sections].sort((a, b) => a.startMeasure - b.startMeasure);
	return sorted.map((sec, i) => ({
		...sec,
		endMeasure: (sorted[i + 1]?.startMeasure ?? measureCount) - 1,
	}));
}

export function dedupeSections(sections: Section[]): Section[] {
	const seen = new Set<number>();
	return sections.filter((s) => {
		if (seen.has(s.startMeasure)) return false;
		seen.add(s.startMeasure);
		return true;
	});
}

export function deepCopyMeasures(measures: Measure[]): Measure[] {
	return measures.map((measure) => measure.map((col) => col.slice()));
}

// The only splice sites for a track's timeline.
export function insertMeasuresIntoTrack(t: Track, at: number, measures: Measure[]): Track {
	const nextMeasures = t.measures.slice();
	nextMeasures.splice(at, 0, ...measures);
	return { ...t, measures: nextMeasures };
}

export function insertBlankMeasures(t: Track, at: number, count: number): Track {
	return insertMeasuresIntoTrack(t, at, makeMeasures(t.tuning.length, count));
}

export function deleteMeasuresFromTrack(t: Track, drop: Set<number>): Track {
	return { ...t, measures: t.measures.filter((_, i) => !drop.has(i)) };
}

function cellEq(a: string | null | undefined, b: string | null | undefined): boolean {
	const na = a === "" || a == null ? null : a;
	const nb = b === "" || b == null ? null : b;
	return na === nb;
}

export function measuresEqual(a: Measure | undefined, b: Measure | undefined): boolean {
	if (!a || !b) return a === b;
	if (a.length !== b.length) return false;
	return a.every((col, c) => col.length === b[c].length && col.every((v, s) => cellEq(v, b[c][s])));
}

export function measureIsEmpty(measure: Measure | undefined): boolean {
	return (measure ?? []).every((col) => col.every((v) => v === null || v === ""));
}
