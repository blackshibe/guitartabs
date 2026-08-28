import { describe, expect, it } from "vitest";
import { copyRange, globalCol, normalizeRect, parsePayload, sectionToClipboard } from "../clipboard";
import { sectionRangesFor } from "../songOps";
import { buildTrack, poke } from "./helpers";

describe("globalCol", () => {
	it("flattens measure/column into a global column", () => {
		expect(globalCol(0, 0)).toBe(0);
		expect(globalCol(0, 7)).toBe(7);
		expect(globalCol(1, 0)).toBe(8);
		expect(globalCol(3, 5)).toBe(29);
	});
});

describe("normalizeRect", () => {
	it("orders an inverted selection", () => {
		const rect = normalizeRect({
			anchor: { measure: 2, column: 3, stringIndex: 1 },
			focus: { measure: 0, column: 1, stringIndex: 0 },
		});
		expect(rect).toEqual({ startColumn: 1, endColumn: 19, startString: 0, endString: 1 });
	});

	it("collapses a single-cell selection to a unit rect", () => {
		const cell = { measure: 1, column: 2, stringIndex: 1 };
		const rect = normalizeRect({ anchor: cell, focus: cell });
		expect(rect).toEqual({ startColumn: 10, endColumn: 10, startString: 1, endString: 1 });
	});
});

describe("copyRange", () => {
	it("copies values and nulls across a measure boundary", () => {
		const track = buildTrack(1, 2);
		poke(track, 0, 7, 0, "5");
		poke(track, 1, 0, 0, "7");
		const clip = copyRange(track, { startColumn: 7, endColumn: 8, startString: 0, endString: 1 });
		expect(clip.kind).toBe("tab-editor/cells");
		expect(clip.rows).toBe(2);
		expect(clip.cols).toBe(2);
		expect(clip.data).toEqual([
			["5", "7"],
			[null, null],
		]);
	});

	it("clamps string rows to the track's string count", () => {
		const track = buildTrack(1, 1);
		const clip = copyRange(track, { startColumn: 0, endColumn: 0, startString: 0, endString: 99 });
		expect(clip.rows).toBe(2);
	});

	it("treats out-of-range columns as nulls", () => {
		const track = buildTrack(1, 1);
		const clip = copyRange(track, { startColumn: 7, endColumn: 9, startString: 0, endString: 0 });
		expect(clip.data).toEqual([[null, null, null]]);
	});
});

describe("sectionToClipboard", () => {
	it("captures span, content, comments, and measure notes", () => {
		const track = buildTrack(1, 4);
		poke(track, 2, 0, 0, "3");
		const sections = [
			{ id: 1, name: "A", startMeasure: 0 },
			{ id: 2, name: "B", startMeasure: 2, comment: "song note", trackComments: { 1: "track note" } },
		];
		const range = sectionRangesFor(sections, 4).find((candidate) => candidate.id === 2)!;
		const clip = sectionToClipboard([track], range, "song-1", ["", "", "note-a", "note-b"]);
		expect(clip.span).toBe(2);
		expect(clip.name).toBe("B");
		expect(clip.comment).toBe("song note");
		expect(clip.trackComments).toEqual({ 0: "track note" });
		expect(clip.tracks[0].measures).toHaveLength(2);
		expect(clip.tracks[0].measures[0][0][0]).toBe("3");
		expect(clip.measureNotes).toEqual(["note-a", "note-b"]);
		expect(clip.songId).toBe("song-1");
	});

	it("records the link root as sourceId", () => {
		const track = buildTrack(1, 2);
		const sections = [
			{ id: 1, name: "A", startMeasure: 0 },
			{ id: 2, name: "A copy", startMeasure: 1, linkTo: 1 },
		];
		const range = sectionRangesFor(sections, 2).find((candidate) => candidate.id === 2)!;
		expect(sectionToClipboard([track], range, "song-1", undefined).sourceId).toBe(1);
	});
});

describe("parsePayload", () => {
	it("accepts a cells payload", () => {
		const json = JSON.stringify({ kind: "tab-editor/cells", rows: 1, cols: 1, data: [["1"]] });
		expect(parsePayload(json)?.kind).toBe("tab-editor/cells");
	});

	it("accepts a section payload", () => {
		const json = JSON.stringify({ kind: "tab-editor/section", name: "A", span: 1, tracks: [], songId: "x", sourceId: 1 });
		expect(parsePayload(json)?.kind).toBe("tab-editor/section");
	});

	it("rejects other JSON and non-JSON", () => {
		expect(parsePayload('{"kind":"something-else"}')).toBeNull();
		expect(parsePayload("not json at all")).toBeNull();
		expect(parsePayload("42")).toBeNull();
	});
});
