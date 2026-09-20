import type { ProgressionEntry, SectionRange, Song, Track } from "../types";
import { COLS_PER_MEASURE, chunkMeasures, stringMidi } from "./instruments";
import { midiToNoteName } from "./tunings";
import { cellRingBars, exportCellLabel } from "./cellValue";
import { measureIsEmpty, measuresEqual, sectionRangesFor } from "./songOps";

function trackMeasureEq(track: Track, a: number, b: number): boolean {
	return measuresEqual(track.measures[a], track.measures[b]);
}

function sectionsEqualFor(track: Track, a: SectionRange, b: SectionRange): boolean {
	if (a.name !== b.name) return false;
	const span = a.endMeasure - a.startMeasure + 1;
	if (span !== b.endMeasure - b.startMeasure + 1) return false;
	for (let off = 0; off < span; off++) {
		if (!trackMeasureEq(track, a.startMeasure + off, b.startMeasure + off)) return false;
	}
	return true;
}

// Smallest unit the index list is a whole number of repetitions of.
function findRepeatUnit(indices: number[], eq: (a: number, b: number) => boolean): { unit: number; times: number } {
	const len = indices.length;
	for (let unit = 1; unit <= Math.floor(len / 2); unit++) {
		if (len % unit !== 0) continue;
		let ok = true;
		for (let i = unit; i < len && ok; i++) ok = eq(indices[i], indices[i - unit]);
		if (ok) return { unit, times: len / unit };
	}
	return { unit: len, times: 1 };
}

// Which printed columns a sustained note is still ringing through, per string —
// stopped by the next note on that string. Text export prints them as "~"
// instead of "-"; the PDF draws a ring line over them.
export function ringFill(track: Track, measureIndices: number[]): boolean[][] {
	const columns = measureIndices.length * COLS_PER_MEASURE;
	const valueAt = (stringIndex: number, position: number) =>
		track.measures[measureIndices[Math.floor(position / COLS_PER_MEASURE)]]?.[position % COLS_PER_MEASURE]?.[
			stringIndex
		] ?? null;
	return track.tuning.map((_, stringIndex) => {
		const fill: boolean[] = Array(columns).fill(false);
		for (let position = 0; position < columns; position++) {
			const bars = cellRingBars(valueAt(stringIndex, position));
			if (bars === 0) continue;
			const last = Math.min(position + bars * COLS_PER_MEASURE, columns);
			for (let ahead = position + 1; ahead < last; ahead++) {
				const value = valueAt(stringIndex, ahead);
				if (value !== null && value !== "") break;
				fill[ahead] = true;
			}
		}
		return fill;
	});
}

function stringsLines(track: Track, measureIndices: number[]): string[] {
	// One column width for the whole section: any 2-digit fret widens every column.
	const width = Math.max(
		2,
		...measureIndices.flatMap((m) =>
			(track.measures[m] ?? []).map(
				(col) => Math.max(...col.map((value) => (exportCellLabel(value) ?? "-").length)) + 1,
			),
		),
	);
	const fill = ringFill(track, measureIndices);
	const out: string[] = [];
	chunkMeasures(measureIndices).forEach((lineMeasures) => {
		const base = measureIndices.indexOf(lineMeasures[0]) * COLS_PER_MEASURE;
		const lines = track.tuning.map((str) => midiToNoteName(stringMidi(str)).padEnd(2, " ") + "|");
		lineMeasures.forEach((m, lineIndex) => {
			const measure = track.measures[m];
			if (!measure) return;
			measure.forEach((col, ci) => {
				const position = base + lineIndex * COLS_PER_MEASURE + ci;
				col.forEach((value, s) => {
					const ringing = cellRingBars(value) > 0 || fill[s]?.[position] === true;
					const label = exportCellLabel(value) ?? (ringing ? "~" : "-");
					lines[s] += (ci === 0 ? " " : "") + label.padEnd(width, ringing ? "~" : " ");
				});
			});
			lines.forEach((_, s) => (lines[s] += "|"));
		});
		out.push(...lines, "");
	});
	return out;
}

function trackSectionEmpty(track: Track, measureIndices: number[]): boolean {
	return measureIndices.every((m) => measureIsEmpty(track.measures[m]));
}

interface ArrangementStep {
	section: SectionRange;
	repeat: number;
}

function arrangementSteps(song: Song): ArrangementStep[] {
	const ranges = sectionRangesFor(song.sections, song.measureCount);
	const byId = new Map(ranges.map((range) => [range.id, range]));
	const entries: ProgressionEntry[] =
		song.progression ?? ranges.map((range) => ({ id: range.id, sectionId: range.id, repeat: 1 }));
	return entries
		.map((entry) => ({ section: byId.get(entry.sectionId), repeat: Math.max(1, entry.repeat) }))
		.filter((step): step is ArrangementStep => step.section !== undefined);
}

/** One folded arrangement block of a track: a section, how often it plays, what to print. */
export interface TrackSheetSection {
	name: string;
	repeats: number;
	comments: string[];
	measureIndices: number[];
}

// The shared arrangement fold both exports draw from: consecutive steps with
// identical content merge, and a section that is k repetitions of a smaller
// unit keeps the unit once with its play count multiplied.
export function trackSheetSections(song: Song, track: Track): TrackSheetSection[] {
	const steps = arrangementSteps(song);
	const out: TrackSheetSection[] = [];
	let i = 0;
	while (i < steps.length) {
		const sec = steps[i].section;
		let groupCount = steps[i].repeat;
		i += 1;
		while (i < steps.length && sectionsEqualFor(track, sec, steps[i].section)) {
			groupCount += steps[i].repeat;
			i += 1;
		}
		const span = sec.endMeasure - sec.startMeasure + 1;
		const allIndices = Array.from({ length: span }, (_, off) => sec.startMeasure + off);
		const { unit, times } = findRepeatUnit(allIndices, (a, b) => trackMeasureEq(track, a, b));
		const measureIndices = allIndices.slice(0, unit);
		if (trackSectionEmpty(track, measureIndices)) continue;
		const comments = [sec.comment, sec.trackComments?.[track.id]]
			.filter((text): text is string => !!text)
			.flatMap((text) => text.split("\n"));
		out.push({ name: sec.name, repeats: groupCount * times, comments, measureIndices });
	}
	return out;
}

function trackLines(song: Song, track: Track): string[] {
	const parts: string[] = [];
	trackSheetSections(song, track).forEach((block) => {
		parts.push(`== ${block.name}${block.repeats > 1 ? ` x${block.repeats}` : ""} ==`);
		parts.push(...block.comments.map((line) => `# ${line}`));
		parts.push(...stringsLines(track, block.measureIndices));
	});
	return parts;
}

// Per-track export, walked in ARRANGEMENT order: the progression says which
// section plays when and how often, so "xN" comes straight off its entries.
// Repeated content still folds further — consecutive steps with identical
// content merge, and a section that is k repetitions of a smaller unit prints
// the unit once.
export function buildExportText(song: Song): string {
	const parts: string[] = [`# ${song.title}`, ""];
	song.tracks.forEach((track) => {
		parts.push(`-- ${track.name} --`);
		parts.push(...trackLines(song, track));
	});
	return parts.join("\n");
}
