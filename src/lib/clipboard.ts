import type { Measure, RangeSelection, SectionRange, Strum, StrumRow, Track } from "../types";
import { COLS_PER_MEASURE } from "./instruments";
import { deepCopyMeasures, strumAt, strumRowsFor } from "./songOps";

// A rectangular cell range: global columns (measure * COLS_PER_MEASURE +
// column) so a selection crosses measure boundaries, string rows
// [startString..endString]. Inclusive.
export interface Rect {
	startColumn: number;
	endColumn: number;
	startString: number;
	endString: number;
}

export function globalCol(measure: number, column: number): number {
	return measure * COLS_PER_MEASURE + column;
}

export function normalizeRect(selection: RangeSelection): Rect {
	const anchorColumn = globalCol(selection.anchor.measure, selection.anchor.column);
	const focusColumn = globalCol(selection.focus.measure, selection.focus.column);
	return {
		startColumn: Math.min(anchorColumn, focusColumn),
		endColumn: Math.max(anchorColumn, focusColumn),
		startString: Math.min(selection.anchor.stringIndex, selection.focus.stringIndex),
		endString: Math.max(selection.anchor.stringIndex, selection.focus.stringIndex),
	};
}

export interface CellClipboard {
	kind: "tab-editor/cells";
	rows: number;
	cols: number;
	/** data[row][col], row 0 = rect's top string */
	data: (string | null)[][];
	/** strums[col] — only when the copy spanned every string (whole columns) */
	strums?: (Strum | null)[];
}

export interface SectionClipboard {
	kind: "tab-editor/section";
	name: string;
	span: number;
	comment?: string;
	/** by track index at copy time */
	trackComments?: Record<number, string>;
	tracks: { measures: Measure[]; strums?: StrumRow[] }[];
	/** measureNotes[off] for off in [0, span) */
	measureNotes?: string[];
	/** origin song — linking is only offered inside the same song */
	songId: string;
	/** root section this was copied from (linkTo resolved) */
	sourceId: number;
	colorIndex?: number;
}

export type ClipboardPayload = CellClipboard | SectionClipboard;

export function copyRange(track: Track, rect: Rect): CellClipboard {
	const endString = Math.min(rect.endString, track.tuning.length - 1);
	const rows = endString - rect.startString + 1;
	const cols = rect.endColumn - rect.startColumn + 1;
	const data: (string | null)[][] = [];
	for (let row = 0; row < rows; row++) {
		const values: (string | null)[] = [];
		for (let offset = 0; offset < cols; offset++) {
			const column = rect.startColumn + offset;
			const measure = Math.floor(column / COLS_PER_MEASURE);
			const columnInMeasure = column % COLS_PER_MEASURE;
			values.push(track.measures[measure]?.[columnInMeasure]?.[rect.startString + row] ?? null);
		}
		data.push(values);
	}
	const clip: CellClipboard = { kind: "tab-editor/cells", rows, cols, data };
	if (rect.startString <= 0 && endString >= track.tuning.length - 1) {
		clip.strums = Array.from({ length: cols }, (_, offset) => {
			const column = rect.startColumn + offset;
			return strumAt(track, Math.floor(column / COLS_PER_MEASURE), column % COLS_PER_MEASURE);
		});
	}
	return clip;
}

export function sectionToClipboard(
	tracks: Track[],
	section: SectionRange,
	songId: string,
	measureNotes: string[] | undefined,
): SectionClipboard {
	const span = section.endMeasure - section.startMeasure + 1;
	const trackComments: Record<number, string> = {};
	tracks.forEach((track, index) => {
		const text = section.trackComments?.[track.id];
		if (text) trackComments[index] = text;
	});
	return {
		kind: "tab-editor/section",
		name: section.name,
		span,
		comment: section.comment,
		trackComments: Object.keys(trackComments).length ? trackComments : undefined,
		songId,
		sourceId: section.linkTo ?? section.id,
		colorIndex: section.colorIndex,
		tracks: tracks.map((track) => ({
			measures: deepCopyMeasures(track.measures.slice(section.startMeasure, section.endMeasure + 1)),
			strums: track.strums ? strumRowsFor(track, section.startMeasure, section.endMeasure) : undefined,
		})),
		measureNotes: measureNotes?.slice(section.startMeasure, section.endMeasure + 1),
	};
}

// Best-effort parse of an OS-clipboard payload written by copy.
export function parsePayload(text: string): ClipboardPayload | null {
	try {
		const parsed = JSON.parse(text) as ClipboardPayload;
		if (parsed && (parsed.kind === "tab-editor/cells" || parsed.kind === "tab-editor/section")) return parsed;
	} catch {
		// not ours
	}
	return null;
}
