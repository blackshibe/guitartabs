import type { SectionRange, Song, Track } from "../types";
import { chunkMeasures, stringMidi } from "./instruments";
import { midiToNoteName } from "./tunings";
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

function stringsLines(track: Track, measureIndices: number[]): string[] {
	// One column width for the whole section: any 2-digit fret widens every column.
	const width = Math.max(
		2,
		...measureIndices.flatMap((m) =>
			(track.measures[m] ?? []).map(
				(col) => Math.max(...col.map((fret) => (fret === null ? 1 : String(fret).length))) + 1,
			),
		),
	);
	const out: string[] = [];
	chunkMeasures(measureIndices).forEach((lineMeasures) => {
		const lines = track.tuning.map((str) => midiToNoteName(stringMidi(str)).padEnd(2, " ") + "|");
		lineMeasures.forEach((m) => {
			const measure = track.measures[m];
			if (!measure) return;
			measure.forEach((col, ci) => {
				col.forEach((fret, s) => {
					const label = fret === null ? "-" : String(fret);
					lines[s] += (ci === 0 ? " " : "") + label.padEnd(width, " ");
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

// Per-track export. Repeated content folds back to "xN": consecutive
// identical sections merge, and a section that is k repetitions of a
// smaller unit prints the unit once.
export function buildExportText(song: Song): string {
	const ranges = sectionRangesFor(song.sections, song.measureCount);
	const parts: string[] = [`# ${song.title}`, ""];
	song.tracks.forEach((track) => {
		parts.push(`-- ${track.name} --`);
		let i = 0;
		while (i < ranges.length) {
			const sec = ranges[i];
			let groupCount = 1;
			while (i + groupCount < ranges.length && sectionsEqualFor(track, sec, ranges[i + groupCount])) groupCount++;
			i += groupCount;
			const span = sec.endMeasure - sec.startMeasure + 1;
			const allIndices = Array.from({ length: span }, (_, off) => sec.startMeasure + off);
			const { unit, times } = findRepeatUnit(allIndices, (a, b) => trackMeasureEq(track, a, b));
			const measureIndices = allIndices.slice(0, unit);
			if (trackSectionEmpty(track, measureIndices)) continue;
			const repeats = groupCount * times;
			parts.push(`== ${sec.name}${repeats > 1 ? ` x${repeats}` : ""} ==`);
			const pushComment = (text: string | undefined) => {
				if (text) parts.push(...text.split("\n").map((line) => `# ${line}`));
			};
			pushComment(sec.comment);
			pushComment(sec.trackComments?.[track.id]);
			parts.push(...stringsLines(track, measureIndices));
		}
	});
	return parts.join("\n");
}
