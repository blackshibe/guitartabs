import { describe, expect, it } from "vitest";
import { historyReducer, initHistory, songReducer, type SongState } from "../songReducer";
import type { Song } from "../../types";
import { buildSong, buildTrack } from "./helpers";

function stateOf(song: Song): SongState {
	return songReducer({} as SongState, { type: "load-song", song });
}

/** Two equal-span sections (measures 0–1 and 2–3) on one track. */
function twoSectionSong(): Song {
	return buildSong({
		sections: [
			{ id: 1, name: "A", startMeasure: 0 },
			{ id: 2, name: "B", startMeasure: 2 },
		],
	});
}

describe("load-song", () => {
	it("fills defaults for optional fields", () => {
		const state = stateOf(buildSong());
		expect(state.measureNotes).toEqual([]);
		expect(state.stems).toEqual([]);
		expect(state.updatedAt).toBe(0);
	});
});

describe("guarded no-ops return the same state reference", () => {
	const state = stateOf(buildSong());
	it.each([
		["identical title", { type: "set-title", title: "Test Song" }],
		["identical bpm", { type: "set-bpm", bpm: 120 }],
		[
			"set-cell out-of-range measure",
			{ type: "set-cell", trackId: 10, measure: 99, column: 0, stringIndex: 0, value: "1" },
		],
		[
			"set-cell out-of-range string",
			{ type: "set-cell", trackId: 10, measure: 0, column: 0, stringIndex: 9, value: "1" },
		],
		[
			"set-cell unknown track",
			{ type: "set-cell", trackId: 404, measure: 0, column: 0, stringIndex: 0, value: "1" },
		],
		["delete last remaining measure guard", { type: "delete-measure", measure: 99 }],
		["add-section-at collision", { type: "add-section-at", measure: 0 }],
		["delete only section", { type: "delete-section", id: 1 }],
		["remove only track", { type: "remove-track", id: 10 }],
		["unlink unlinked section", { type: "unlink-section", id: 1 }],
		["remove unknown stem", { type: "remove-stem", id: 5 }],
	] as const)("%s", (_name, action) => {
		expect(songReducer(state, action as never)).toBe(state);
	});
});

describe("set-cell", () => {
	it("writes a value without touching other cells", () => {
		const state = stateOf(buildSong());
		const next = songReducer(state, {
			type: "set-cell",
			trackId: 10,
			measure: 1,
			column: 2,
			stringIndex: 1,
			value: "7",
		});
		expect(next.tracks[0].measures[1][2][1]).toBe("7");
		expect(next.tracks[0].measures[0][0][0]).toBeNull();
		expect(state.tracks[0].measures[1][2][1]).toBeNull(); // immutability
	});
});

describe("linked sections", () => {
	function linkedState(): SongState {
		const state = stateOf(twoSectionSong());
		return songReducer(state, { type: "link-section", id: 2, to: 1 });
	}

	it("link-section requires equal spans", () => {
		const uneven = stateOf(
			buildSong({
				sections: [
					{ id: 1, name: "A", startMeasure: 0 },
					{ id: 2, name: "B", startMeasure: 3 },
				],
			}),
		);
		expect(songReducer(uneven, { type: "link-section", id: 2, to: 1 })).toBe(uneven);
	});

	it("link-section copies the source content and assigns a shared color", () => {
		const seeded = songReducer(stateOf(twoSectionSong()), {
			type: "set-cell",
			trackId: 10,
			measure: 0,
			column: 0,
			stringIndex: 0,
			value: "5",
		});
		const linked = songReducer(seeded, { type: "link-section", id: 2, to: 1 });
		expect(linked.tracks[0].measures[2][0][0]).toBe("5");
		const [a, b] = linked.sections;
		expect(b.linkTo).toBe(1);
		expect(a.colorIndex).toBe(b.colorIndex);
	});

	it("link-section resolves chains to one root", () => {
		const three = stateOf(
			buildSong({
				measureCount: 3,
				tracks: [buildTrack(10, 3)],
				sections: [
					{ id: 1, name: "A", startMeasure: 0 },
					{ id: 2, name: "B", startMeasure: 1 },
					{ id: 3, name: "C", startMeasure: 2 },
				],
			}),
		);
		let state = songReducer(three, { type: "link-section", id: 2, to: 1 });
		state = songReducer(state, { type: "link-section", id: 3, to: 2 });
		expect(state.sections.find((section) => section.id === 3)?.linkTo).toBe(1);
	});

	it("a cell edit fans out to every linked copy", () => {
		const next = songReducer(linkedState(), {
			type: "set-cell",
			trackId: 10,
			measure: 3,
			column: 4,
			stringIndex: 0,
			value: "9",
		});
		expect(next.tracks[0].measures[1][4][0]).toBe("9"); // mirrored at same offset in section A
	});

	it("set-measure-note mirrors across the linked group", () => {
		const next = songReducer(linkedState(), { type: "set-measure-note", measure: 0, text: "chorus riff" });
		expect(next.measureNotes[0]).toBe("chorus riff");
		expect(next.measureNotes[2]).toBe("chorus riff");
	});

	it("unlink-section stops the mirroring", () => {
		const unlinked = songReducer(linkedState(), { type: "unlink-section", id: 2 });
		const next = songReducer(unlinked, {
			type: "set-cell",
			trackId: 10,
			measure: 0,
			column: 0,
			stringIndex: 0,
			value: "3",
		});
		expect(next.tracks[0].measures[2][0][0]).toBeNull();
	});
});

describe("track loops", () => {
	it("set-track-loop mirrors bars beyond the unit and records the unit", () => {
		const seeded = songReducer(stateOf(buildSong()), {
			type: "set-cell",
			trackId: 10,
			measure: 0,
			column: 1,
			stringIndex: 0,
			value: "2",
		});
		const looped = songReducer(seeded, { type: "set-track-loop", trackId: 10, sectionId: 1, unit: 1 });
		expect(looped.tracks[0].loops).toEqual({ 1: 1 });
		for (let measure = 1; measure < 4; measure++) expect(looped.tracks[0].measures[measure][1][0]).toBe("2");
	});

	it("rejects a unit as large as the span", () => {
		const state = stateOf(buildSong());
		expect(songReducer(state, { type: "set-track-loop", trackId: 10, sectionId: 1, unit: 4 })).toBe(state);
	});

	it("a cell edit inside the loop repeats across the unit", () => {
		const looped = songReducer(stateOf(buildSong()), {
			type: "set-track-loop",
			trackId: 10,
			sectionId: 1,
			unit: 2,
		});
		const next = songReducer(looped, {
			type: "set-cell",
			trackId: 10,
			measure: 1,
			column: 0,
			stringIndex: 0,
			value: "4",
		});
		expect(next.tracks[0].measures[3][0][0]).toBe("4");
		expect(next.tracks[0].measures[0][0][0]).toBeNull();
	});

	it("clearing the loop keeps the written-out bars", () => {
		const seeded = songReducer(stateOf(buildSong()), {
			type: "set-cell",
			trackId: 10,
			measure: 0,
			column: 0,
			stringIndex: 0,
			value: "1",
		});
		const looped = songReducer(seeded, { type: "set-track-loop", trackId: 10, sectionId: 1, unit: 1 });
		const cleared = songReducer(looped, { type: "set-track-loop", trackId: 10, sectionId: 1, unit: null });
		expect(cleared.tracks[0].loops?.[1]).toBeUndefined();
		expect(cleared.tracks[0].measures[3][0][0]).toBe("1");
	});
});

describe("measure timeline", () => {
	it("insert-measure grows every track, shifts sections, and splices notes", () => {
		let state = stateOf(twoSectionSong());
		state = songReducer(state, { type: "set-measure-note", measure: 2, text: "bridge" });
		const next = songReducer(state, { type: "insert-measure", after: 0 });
		expect(next.measureCount).toBe(5);
		expect(next.tracks[0].measures).toHaveLength(5);
		expect(next.sections.find((section) => section.id === 2)?.startMeasure).toBe(3);
		expect(next.measureNotes[3]).toBe("bridge");
	});

	it("delete-measure shifts sections and drops the note", () => {
		let state = stateOf(twoSectionSong());
		state = songReducer(state, { type: "set-measure-note", measure: 3, text: "keep" });
		const next = songReducer(state, { type: "delete-measure", measure: 0 });
		expect(next.measureCount).toBe(3);
		expect(next.sections.find((section) => section.id === 2)?.startMeasure).toBe(1);
		expect(next.measureNotes).toEqual(["", "", "keep"]);
		expect(next.sections[0].startMeasure).toBe(0);
	});

	it("delete-measure dedupes colliding sections and re-clamps to measure 0", () => {
		const state = stateOf(
			buildSong({
				measureCount: 2,
				tracks: [buildTrack(10, 2)],
				sections: [
					{ id: 1, name: "A", startMeasure: 0 },
					{ id: 2, name: "B", startMeasure: 1 },
				],
			}),
		);
		const next = songReducer(state, { type: "delete-measure", measure: 0 });
		expect(next.sections).toHaveLength(1);
		expect(next.sections[0].startMeasure).toBe(0);
	});

	it("delete-measure drops a loop whose unit no longer fits the span", () => {
		const looped = songReducer(stateOf(buildSong()), {
			type: "set-track-loop",
			trackId: 10,
			sectionId: 1,
			unit: 3,
		});
		const next = songReducer(looped, { type: "delete-measure", measure: 3 });
		expect(next.tracks[0].loops?.[1]).toBeUndefined();
	});
});

describe("sections", () => {
	it("add-section-at appends a marker inside the timeline", () => {
		const next = songReducer(stateOf(buildSong()), { type: "add-section-at", measure: 2 });
		expect(next.sections).toHaveLength(2);
		expect(next.sections[1].startMeasure).toBe(2);
	});

	it("add-section-after grows the timeline on collision", () => {
		const next = songReducer(stateOf(buildSong()), { type: "add-section-after", measure: 0 });
		expect(next.measureCount).toBe(5);
		expect(next.sections).toHaveLength(2);
	});

	it("delete-section clears dangling linkTo and loops", () => {
		let state = stateOf(twoSectionSong());
		state = songReducer(state, { type: "link-section", id: 2, to: 1 });
		state = songReducer(state, { type: "set-track-loop", trackId: 10, sectionId: 1, unit: 1 });
		const next = songReducer(state, { type: "delete-section", id: 1 });
		expect(next.sections).toHaveLength(1);
		expect(next.sections[0].linkTo).toBeUndefined();
		expect(next.sections[0].startMeasure).toBe(0);
		expect(next.tracks[0].loops?.[1]).toBeUndefined();
	});
});

describe("paste-section", () => {
	it("inserts the clip's content, comments, and notes", () => {
		const clip = {
			kind: "tab-editor/section" as const,
			name: "Pasted",
			span: 1,
			comment: "note",
			trackComments: { 0: "tc" },
			tracks: [
				{ measures: [[["3", null], ...Array.from({ length: 7 }, () => [null, null])] as (string | null)[][]] },
			],
			measureNotes: ["m-note"],
			songId: "song-1",
			sourceId: 1,
		};
		const next = songReducer(stateOf(buildSong()), { type: "paste-section", at: 4, clip });
		expect(next.measureCount).toBe(5);
		const pasted = next.sections.find((section) => section.name === "Pasted")!;
		expect(pasted.startMeasure).toBe(4);
		expect(pasted.comment).toBe("note");
		expect(pasted.trackComments).toEqual({ 10: "tc" });
		expect(next.tracks[0].measures[4][0][0]).toBe("3");
		expect(next.measureNotes[4]).toBe("m-note");
	});

	it("pads clips from tracks with more strings", () => {
		const clip = {
			kind: "tab-editor/section" as const,
			name: "Wide",
			span: 1,
			tracks: [{ measures: [Array.from({ length: 8 }, () => ["1", "2", "3", "4"]) as (string | null)[][]] }],
			songId: "song-1",
			sourceId: 1,
		};
		const next = songReducer(stateOf(buildSong()), { type: "paste-section", at: 0, clip });
		expect(next.tracks[0].measures[0][0]).toEqual(["1", "2"]);
	});
});

describe("tracks, volumes, stems, backings", () => {
	it("set-track-tuning pads and trims existing columns", () => {
		const state = stateOf(buildSong());
		const grown = songReducer(state, {
			type: "set-track-tuning",
			id: 10,
			tuning: [...state.tracks[0].tuning, { noteIndex: 7, octave: 3 }],
		});
		expect(grown.tracks[0].measures[0][0]).toHaveLength(3);
		const shrunk = songReducer(grown, {
			type: "set-track-tuning",
			id: 10,
			tuning: grown.tracks[0].tuning.slice(0, 1),
		});
		expect(shrunk.tracks[0].measures[0][0]).toHaveLength(1);
	});

	it("set-track-volume clamps to [0, 1]", () => {
		const state = stateOf(buildSong());
		expect(songReducer(state, { type: "set-track-volume", id: 10, volume: 2 }).tracks[0].volume).toBe(1);
		expect(songReducer(state, { type: "set-track-volume", id: 10, volume: -1 }).tracks[0].volume).toBe(0);
	});

	it("set-track-backing attaches and removes cleanly", () => {
		const state = stateOf(buildSong());
		const backing = { name: "part.mp3", mime: "audio/mpeg", data: "aGk=" };
		const withBacking = songReducer(state, { type: "set-track-backing", id: 10, backing });
		expect(withBacking.tracks[0].backing).toEqual(backing);
		const removed = songReducer(withBacking, { type: "set-track-backing", id: 10, backing: null });
		expect("backing" in removed.tracks[0]).toBe(false);
	});

	it("stems add, set volume (clamped), and remove", () => {
		const state = stateOf(buildSong());
		const stem = { id: 77, name: "drums.ogg", mime: "audio/ogg", data: "aGk=" };
		let next = songReducer(state, { type: "add-stem", stem });
		expect(next.stems).toEqual([stem]);
		next = songReducer(next, { type: "set-stem-volume", id: 77, volume: 5 });
		expect(next.stems[0].volume).toBe(1);
		next = songReducer(next, { type: "remove-stem", id: 77 });
		expect(next.stems).toEqual([]);
	});
});

describe("youtube reference", () => {
	it("attaches with a default anchor, keeps the anchor across video swaps, and detaches", () => {
		let state = songReducer(stateOf(buildSong()), { type: "set-youtube-video", videoId: "dQw4w9WgXcQ" });
		expect(state.youtube).toEqual({ videoId: "dQw4w9WgXcQ", anchorMeasure: 0, anchorSeconds: 0 });
		state = songReducer(state, { type: "set-youtube-anchor", measure: 2, seconds: 12.5 });
		state = songReducer(state, { type: "set-youtube-video", videoId: "abcdefghijk" });
		expect(state.youtube).toEqual({ videoId: "abcdefghijk", anchorMeasure: 2, anchorSeconds: 12.5 });
		state = songReducer(state, { type: "set-youtube-video", videoId: null });
		expect(state.youtube).toBeUndefined();
	});
});

describe("history", () => {
	it("undo and redo walk the stack", () => {
		let history = initHistory(buildSong());
		history = historyReducer(history, { type: "set-bpm", bpm: 90 });
		history = historyReducer(history, { type: "undo" });
		expect(history.present.bpm).toBe(120);
		history = historyReducer(history, { type: "redo" });
		expect(history.present.bpm).toBe(90);
	});

	it("undo with no past and redo with no future are no-ops", () => {
		const history = initHistory(buildSong());
		expect(historyReducer(history, { type: "undo" })).toBe(history);
		expect(historyReducer(history, { type: "redo" })).toBe(history);
	});

	it("coalesces consecutive same-target edits into one undo step", () => {
		let history = initHistory(buildSong());
		history = historyReducer(history, {
			type: "set-cell",
			trackId: 10,
			measure: 0,
			column: 0,
			stringIndex: 0,
			value: "1",
		});
		history = historyReducer(history, {
			type: "set-cell",
			trackId: 10,
			measure: 0,
			column: 0,
			stringIndex: 0,
			value: "12",
		});
		expect(history.past).toHaveLength(1);
		history = historyReducer(history, { type: "undo" });
		expect(history.present.tracks[0].measures[0][0][0]).toBeNull();
	});

	it("does not coalesce edits to different cells", () => {
		let history = initHistory(buildSong());
		history = historyReducer(history, {
			type: "set-cell",
			trackId: 10,
			measure: 0,
			column: 0,
			stringIndex: 0,
			value: "1",
		});
		history = historyReducer(history, {
			type: "set-cell",
			trackId: 10,
			measure: 0,
			column: 1,
			stringIndex: 0,
			value: "2",
		});
		expect(history.past).toHaveLength(2);
	});

	it("a new edit clears the redo future", () => {
		let history = initHistory(buildSong());
		history = historyReducer(history, { type: "set-bpm", bpm: 90 });
		history = historyReducer(history, { type: "undo" });
		history = historyReducer(history, { type: "set-title", title: "New" });
		expect(history.future).toEqual([]);
	});

	it("guarded no-op actions do not push history", () => {
		let history = initHistory(buildSong());
		history = historyReducer(history, { type: "set-bpm", bpm: 120 });
		expect(history.past).toHaveLength(0);
	});

	it("caps the past at 100 entries", () => {
		let history = initHistory(buildSong());
		for (let i = 0; i < 130; i++) {
			history = historyReducer(history, {
				type: "add-stem",
				stem: { id: 1000 + i, name: "s", mime: "audio/ogg", data: "" },
			});
		}
		expect(history.past).toHaveLength(100);
	});

	it("load-song resets both stacks", () => {
		let history = initHistory(buildSong());
		history = historyReducer(history, { type: "set-bpm", bpm: 90 });
		history = historyReducer(history, { type: "load-song", song: buildSong({ id: "song-2" }) });
		expect(history.past).toEqual([]);
		expect(history.future).toEqual([]);
		expect(history.present.id).toBe("song-2");
	});
});
