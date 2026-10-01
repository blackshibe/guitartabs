import type { LyricRow, Measure, Section, StepLyrics, SectionRange, Strum, StrumRow, Track } from "../types";
import { COLS_PER_MEASURE, makeMeasures } from "./instruments";

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

export function blankStrumRow(): StrumRow {
	return Array(COLS_PER_MEASURE).fill(null);
}

export function strumAt(track: Track, measure: number, column: number): Strum | null {
	return track.strums?.[measure]?.[column] ?? null;
}

/** Strum rows for measures [start, end], filled in — for clipboard payloads. */
export function strumRowsFor(track: Track, start: number, end: number): StrumRow[] {
	return Array.from({ length: end - start + 1 }, (_, off) =>
		Array.from({ length: COLS_PER_MEASURE }, (_, c) => strumAt(track, start + off, c)),
	);
}

/** Write strum marks; the lazily grown strums array is padded as needed. */
export function writeStrums(t: Track, writes: { measure: number; column: number; strum: Strum | null }[]): Track {
	const strums = (t.strums ?? []).map((row) => row.slice());
	writes.forEach(({ measure, column, strum }) => {
		while (strums.length <= measure) strums.push(blankStrumRow());
		strums[measure][column] = strum;
	});
	return { ...t, strums };
}

// The only splice sites for a track's timeline — strum rows move with their
// measures.
export function insertMeasuresIntoTrack(t: Track, at: number, measures: Measure[], strumRows?: StrumRow[]): Track {
	const nextMeasures = t.measures.slice();
	nextMeasures.splice(at, 0, ...measures);
	const marked = strumRows?.some((row) => row.some((strum) => strum !== null)) ?? false;
	if (!t.strums && !marked) return { ...t, measures: nextMeasures };
	const strums = (t.strums ?? []).slice();
	while (strums.length < at) strums.push(blankStrumRow());
	strums.splice(at, 0, ...measures.map((_, off) => strumRows?.[off]?.slice() ?? blankStrumRow()));
	return { ...t, measures: nextMeasures, strums };
}

export function insertBlankMeasures(t: Track, at: number, count: number): Track {
	return insertMeasuresIntoTrack(t, at, makeMeasures(t.tuning.length, count));
}

export function deleteMeasuresFromTrack(t: Track, drop: Set<number>): Track {
	const measures = t.measures.filter((_, i) => !drop.has(i));
	if (!t.strums) return { ...t, measures };
	return { ...t, measures, strums: t.strums.filter((_, i) => !drop.has(i)) };
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

export function blankLyricRow(): LyricRow {
	return Array(COLS_PER_MEASURE).fill("");
}

export function lyricKey(entryId: number, pass: number): string {
	return `${entryId}:${pass}`;
}

function entryOfKey(key: string): number {
	return Number(key.split(":")[0]);
}

export function stepLyricAt(
	lyrics: StepLyrics | undefined,
	entryId: number,
	pass: number,
	offset: number,
	column: number,
): string {
	return lyrics?.[lyricKey(entryId, pass)]?.[offset]?.[column] ?? "";
}

export function stepLyricRow(lyrics: StepLyrics | undefined, entryId: number, pass: number, offset: number): LyricRow {
	return Array.from({ length: COLS_PER_MEASURE }, (_, c) => stepLyricAt(lyrics, entryId, pass, offset, c));
}

/** Splice the rows of every pass of the given entries at a section offset —
 *  insert `insert` blank rows, or drop `remove` rows. */
export function spliceStepLyrics(
	lyrics: StepLyrics,
	entryIds: Set<number>,
	offset: number,
	insert: number,
	remove: number,
): StepLyrics {
	let changed = false;
	const next: StepLyrics = {};
	for (const [key, rows] of Object.entries(lyrics)) {
		if (!entryIds.has(entryOfKey(key)) || rows.length <= offset) {
			next[key] = rows;
			continue;
		}
		changed = true;
		const spliced = rows.slice();
		spliced.splice(offset, remove, ...Array.from({ length: insert }, blankLyricRow));
		next[key] = spliced;
	}
	return changed ? next : lyrics;
}

/** Drop the lyrics of progression steps that no longer exist. */
export function pruneStepLyrics(lyrics: StepLyrics, entryIds: Set<number>): StepLyrics {
	const keys = Object.keys(lyrics);
	if (keys.every((key) => entryIds.has(entryOfKey(key)))) return lyrics;
	return Object.fromEntries(keys.filter((key) => entryIds.has(entryOfKey(key))).map((key) => [key, lyrics[key]]));
}
