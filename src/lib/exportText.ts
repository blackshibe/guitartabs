import type { LyricRow, ProgressionEntry, SectionRange, Song, Strum, Track } from "../types";
import { COLS_PER_MEASURE, MEASURES_PER_LINE, chunkMeasures, stringMidi } from "./instruments";
import { midiToNoteName } from "./tunings";
import { cellRingBars, exportCellLabel } from "./cellValue";
import { strumLetters } from "./strum";
import { measureIsEmpty, measuresEqual, sectionRangesFor, stepLyricRow, strumAt } from "./songOps";

function measureStrums(track: Track, m: number): (Strum | null)[] {
	return Array.from({ length: COLS_PER_MEASURE }, (_, c) => strumAt(track, m, c));
}

function trackMeasureEq(track: Track, a: number, b: number): boolean {
	if (!measuresEqual(track.measures[a], track.measures[b])) return false;
	const strumsB = measureStrums(track, b);
	return measureStrums(track, a).every((strum, c) => strum === strumsB[c]);
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

function stringsLines(track: Track, measureIndices: number[], verses: LyricRow[][]): string[] {
	const fill = ringFill(track, measureIndices);
	const out: string[] = [];
	// Positions count printed lines, not measure ids — a written-out repeat
	// lists the same measure more than once.
	chunkMeasures(measureIndices).forEach((lineMeasures, lineNumber) => {
		const base = lineNumber * MEASURES_PER_LINE * COLS_PER_MEASURE;
		const lines = track.tuning.map((str) => midiToNoteName(stringMidi(str)).padEnd(2, " ") + "|");
		// Strum marks print on their own line under the strings, D / U under
		// their column ("DU" for a split column, which widens it to fit).
		const strummed = lineMeasures.some((m) => measureStrums(track, m).some((strum) => strum !== null));
		let strumLine = "   ";
		// Lyrics print under that, one line per verse sung over these bars,
		// each word starting at its column and spilling right — pushed along
		// when the previous word runs long.
		const firstPrinted = lineNumber * MEASURES_PER_LINE;
		const lineVerses = verses
			.map((rows) => rows.slice(firstPrinted, firstPrinted + lineMeasures.length))
			.filter((rows) => rows.some((row) => row.some((text) => text !== "")));
		const lyricLines = lineVerses.map(() => "");
		lineMeasures.forEach((m, lineIndex) => {
			const measure = track.measures[m];
			if (!measure) return;
			measure.forEach((col, ci) => {
				const position = base + lineIndex * COLS_PER_MEASURE + ci;
				// Each column is only as wide as its own widest label, so one
				// 2-digit fret doesn't stretch every other column.
				const strum = strumLetters(strumAt(track, m, ci));
				const width = Math.max(strum.length, ...col.map((value) => (exportCellLabel(value) ?? "-").length)) + 1;
				const at = lines[0].length + (ci === 0 ? 1 : 0);
				lineVerses.forEach((rows, verse) => {
					const word = rows[lineIndex]?.[ci] ?? "";
					if (word === "") return;
					const sung = lyricLines[verse];
					lyricLines[verse] = sung.padEnd(sung === "" ? at : Math.max(at, sung.length + 1), " ") + word;
				});
				col.forEach((value, s) => {
					const ringing = cellRingBars(value) > 0 || fill[s]?.[position] === true;
					const label = exportCellLabel(value) ?? (ringing ? "~" : "-");
					lines[s] += (ci === 0 ? "-" : "") + label.padEnd(width, ringing ? "~" : "-");
				});
				strumLine += (ci === 0 ? " " : "") + strum.padEnd(width, " ");
			});
			lines.forEach((_, s) => (lines[s] += "|"));
			strumLine += " ";
		});
		out.push(...lines);
		if (strummed) out.push(strumLine.trimEnd());
		out.push(...lyricLines);
		out.push("");
	});
	return out;
}

function trackSectionEmpty(track: Track, measureIndices: number[]): boolean {
	// A strum pattern with no frets under it is still content.
	return measureIndices.every(
		(m) => measureIsEmpty(track.measures[m]) && measureStrums(track, m).every((strum) => strum === null),
	);
}

interface ArrangementStep {
	entryId: number;
	section: SectionRange;
	repeat: number;
}

function arrangementSteps(song: Song): ArrangementStep[] {
	const ranges = sectionRangesFor(song.sections, song.measureCount);
	const byId = new Map(ranges.map((range) => [range.id, range]));
	const entries: ProgressionEntry[] =
		song.progression ?? ranges.map((range) => ({ id: range.id, sectionId: range.id, repeat: 1 }));
	return entries
		.map((entry) => ({ entryId: entry.id, section: byId.get(entry.sectionId), repeat: Math.max(1, entry.repeat) }))
		.filter((step): step is ArrangementStep => step.section !== undefined);
}

/** One folded arrangement block of a track: a section, how often it plays, what to print. */
export interface TrackSheetSection {
	name: string;
	repeats: number;
	comments: string[];
	measureIndices: number[];
	/** 0-based played bar this block starts on — counts every repeat, and the
	 *  bars of sections skipped as empty for this track */
	startBar: number;
	/** verses[v][j] — lyric row sung over printed measure j on the block's
	 *  v-th printed pass; only passes with words in them */
	verses: LyricRow[][];
	/** a later run of the same section (written out for different lyrics) —
	 *  its name is not printed again */
	continues: boolean;
}

// The shared arrangement fold both exports draw from: consecutive steps with
// identical content merge, and a section that is k repetitions of a smaller
// unit keeps the unit once with its play count multiplied.
export function trackSheetSections(song: Song, track: Track): TrackSheetSection[] {
	const steps = arrangementSteps(song);
	const out: TrackSheetSection[] = [];
	let playedBars = 0;
	let i = 0;
	while (i < steps.length) {
		const sec = steps[i].section;
		const group = [steps[i]];
		let groupCount = steps[i].repeat;
		i += 1;
		while (i < steps.length && sectionsEqualFor(track, sec, steps[i].section)) {
			group.push(steps[i]);
			groupCount += steps[i].repeat;
			i += 1;
		}
		const span = sec.endMeasure - sec.startMeasure + 1;
		const allIndices = Array.from({ length: span }, (_, off) => sec.startMeasure + off);
		const { unit, times } = findRepeatUnit(allIndices, (a, b) => trackMeasureEq(track, a, b));
		const measureIndices = allIndices.slice(0, unit);
		const startBar = playedBars;
		playedBars += span * groupCount;
		if (trackSectionEmpty(track, measureIndices)) continue;
		// Only the per-track notes: the song-wide Section.comment has no editor
		// anymore, so whatever it still holds is stale and stays out of exports.
		const comments = [sec.trackComments?.[track.id]]
			.filter((text): text is string => !!text)
			.flatMap((text) => text.split("\n"));
		// A short repeated unit never shrinks below a line: it's written out as
		// many times as fit on one and divide the play count — a 2-bar riff ×8
		// prints as 4 bars ×4, and a section that is one 2-bar riff twice stays
		// its 4 bars as written.
		const repeats = groupCount * times;
		let passes = 1;
		for (let candidate = Math.floor(MEASURES_PER_LINE / measureIndices.length); candidate > 1; candidate--) {
			if (repeats % candidate === 0) {
				passes = candidate;
				break;
			}
		}
		// Folding merged every played pass into one printed block, so the
		// words of each pass come back as stacked verses: unit play u is the
		// (step, pass, unit-within-section) triple in play order.
		const unitPlays = group.flatMap((step) =>
			Array.from({ length: step.repeat * times }, (_, index) => ({
				entryId: step.entryId,
				pass: Math.floor(index / times),
				unitIndex: index % times,
			})),
		);
		const printedLength = passes * unit;
		const renditions = Array.from({ length: repeats / passes }, (_, rendition) =>
			Array.from({ length: printedLength }, (_, j) => {
				const play = unitPlays[rendition * passes + Math.floor(j / unit)];
				return stepLyricRow(song.lyrics, play.entryId, play.pass, play.unitIndex * unit + (j % unit));
			}),
		);
		// A repeat sign only covers passes sung with the same words — passes
		// with different lyrics are written out, each under its own words.
		const printedMeasures = Array.from({ length: passes }, () => measureIndices).flat();
		let run = 0;
		while (run < renditions.length) {
			const words = JSON.stringify(renditions[run]);
			let end = run + 1;
			while (end < renditions.length && JSON.stringify(renditions[end]) === words) end += 1;
			const sung = renditions[run].some((row) => row.some((text) => text !== ""));
			out.push({
				name: sec.name,
				verses: sung ? [renditions[run]] : [],
				repeats: end - run,
				comments: run === 0 ? comments : [],
				continues: run > 0,
				measureIndices: printedMeasures,
				startBar: startBar + run * printedLength,
			});
			run = end;
		}
	}
	return out;
}

function trackLines(song: Song, track: Track): string[] {
	const parts: string[] = [];
	trackSheetSections(song, track).forEach((block) => {
		if (!block.continues) parts.push(`== ${block.name}${block.repeats > 1 ? ` x${block.repeats}` : ""} ==`);
		else if (block.repeats > 1) parts.push(`x${block.repeats}`);
		parts.push(...block.comments.map((line) => `# ${line}`));
		parts.push(...stringsLines(track, block.measureIndices, block.verses));
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
