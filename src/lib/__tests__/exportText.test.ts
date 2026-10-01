import { describe, expect, it } from "vitest";
import { buildExportText, trackSheetSections } from "../exportText";
import { buildSong, buildTrack, poke } from "./helpers";

describe("buildExportText", () => {
	it("renders the title, track header, and fret values", () => {
		const track = buildTrack(10, 1);
		poke(track, 0, 0, 0, "5");
		poke(track, 0, 3, 1, "12");
		const text = buildExportText(buildSong({ measureCount: 1, tracks: [track] }));
		expect(text).toContain("# Test Song");
		expect(text).toContain("-- Track 10 --");
		expect(text).toContain("== Intro ==");
		expect(text).toContain("5");
		expect(text).toContain("12");
	});

	it("skips sections that are empty for a track", () => {
		const text = buildExportText(buildSong());
		expect(text).not.toContain("== Intro ==");
	});

	it("folds a section made of identical measures into xN", () => {
		const track = buildTrack(10, 8);
		for (let m = 0; m < 8; m++) poke(track, m, 0, 0, "3");
		const text = buildExportText(buildSong({ measureCount: 8, tracks: [track] }));
		expect(text).toContain("== Intro x2 ==");
	});

	it("never shrinks a repeated riff below a line", () => {
		const track = buildTrack(10, 4);
		const riff = (m: number) => poke(track, m, 0, 0, m % 2 === 0 ? "3" : "5");
		[0, 1, 2, 3].forEach(riff);
		// a section that is a 2-bar riff twice keeps its 4 bars, no ×2
		const once = buildSong({ measureCount: 4, tracks: [track] });
		expect(trackSheetSections(once, track)[0]).toMatchObject({ measureIndices: [0, 1, 0, 1], repeats: 1 });
		// the riff alone played ×8 fills the line: 4 bars ×4
		const riffOnly = buildSong({
			measureCount: 4,
			tracks: [track],
			sections: [
				{ id: 1, name: "Riff", startMeasure: 0 },
				{ id: 2, name: "Other", startMeasure: 2 },
			],
			progression: [{ id: 90, sectionId: 1, repeat: 8 }],
		});
		expect(trackSheetSections(riffOnly, track)[0]).toMatchObject({ measureIndices: [0, 1, 0, 1], repeats: 4 });
	});

	it("folds consecutive identical sections into xN", () => {
		// two identical 4-bar sections, each bar different so neither folds inside
		const track = buildTrack(10, 8);
		for (let m = 0; m < 8; m++) poke(track, m, m % 4, 0, "7");
		const song = buildSong({
			measureCount: 8,
			tracks: [track],
			sections: [
				{ id: 1, name: "Riff", startMeasure: 0 },
				{ id: 2, name: "Riff", startMeasure: 4 },
			],
		});
		expect(buildExportText(song)).toContain("== Riff x2 ==");
	});

	it("takes its xN and its order from the progression", () => {
		const track = buildTrack(10, 5);
		for (let m = 0; m < 4; m++) poke(track, m, m, 0, "7");
		poke(track, 4, 0, 0, "9");
		const song = buildSong({
			measureCount: 5,
			tracks: [track],
			sections: [
				{ id: 1, name: "Verse", startMeasure: 0 },
				{ id: 2, name: "Chorus", startMeasure: 4 },
			],
			progression: [
				{ id: 90, sectionId: 2, repeat: 1 },
				{ id: 91, sectionId: 1, repeat: 3 },
			],
		});
		const text = buildExportText(song);
		expect(text).toContain("== Verse x3 ==");
		expect(text.indexOf("== Chorus ==")).toBeLessThan(text.indexOf("== Verse x3 =="));
	});

	it("numbers blocks by played bar, counting repeats and empty sections", () => {
		const track = buildTrack(10, 4);
		poke(track, 0, 0, 0, "7");
		poke(track, 3, 0, 0, "9");
		const song = buildSong({
			measureCount: 4,
			tracks: [track],
			sections: [
				{ id: 1, name: "Verse", startMeasure: 0 },
				{ id: 2, name: "Gap", startMeasure: 2 },
				{ id: 3, name: "Chorus", startMeasure: 3 },
			],
			progression: [
				{ id: 90, sectionId: 1, repeat: 3 },
				{ id: 91, sectionId: 2, repeat: 1 },
				{ id: 92, sectionId: 3, repeat: 1 },
			],
		});
		const blocks = trackSheetSections(song, track);
		expect(blocks.map((block) => [block.name, block.startBar])).toEqual([
			["Verse", 0],
			["Chorus", 7],
		]);
	});

	it("prints a sustained note as a ring of tildes, cut by the next note", () => {
		const track = buildTrack(10, 1);
		poke(track, 0, 0, 0, "5=1");
		poke(track, 0, 4, 0, "7");
		const text = buildExportText(buildSong({ measureCount: 1, tracks: [track] }));
		const topString = text.split("\n").find((line) => line.startsWith("E |")) as string;
		expect(topString).toContain("5~~~~~~~7");
	});

	it("sizes each column to its own widest label, not the section's", () => {
		const track = buildTrack(10, 1);
		poke(track, 0, 0, 1, "12");
		poke(track, 0, 2, 0, "1");
		poke(track, 0, 4, 0, "1");
		const text = buildExportText(buildSong({ measureCount: 1, tracks: [track] }));
		const topString = text.split("\n").find((line) => line.startsWith("E |")) as string;
		expect(topString).toBe("E |------1---1-------|");
	});

	it("prints a strum line under the strings, D / U under their column", () => {
		const track = buildTrack(10, 1);
		poke(track, 0, 0, 0, "0");
		poke(track, 0, 0, 1, "12");
		track.strums = [["d", null, "u", null, null, null, null, null]];
		const lines = buildExportText(buildSong({ measureCount: 1, tracks: [track] })).split("\n");
		const top = lines.findIndex((line) => line.startsWith("E |"));
		expect(lines[top + 1]).toMatch(/^B \|/);
		expect(lines[top + 2]).toBe("    D    U");
	});

	it("widens a split-strum column to fit its strokes", () => {
		const track = buildTrack(10, 1);
		poke(track, 0, 0, 0, "0");
		track.strums = [["dud", null, null, null, null, null, null, null]];
		const lines = buildExportText(buildSong({ measureCount: 1, tracks: [track] })).split("\n");
		const top = lines.findIndex((line) => line.startsWith("E |"));
		expect(lines[top]).toMatch(/^E \|-0---/);
		expect(lines[top + 2]).toBe("    DUD");
	});

	it("keeps a strum-only section in the export", () => {
		const track = buildTrack(10, 1);
		track.strums = [["d", null, null, null, "u", null, null, null]];
		expect(buildExportText(buildSong({ measureCount: 1, tracks: [track] }))).toContain("== Intro ==");
	});

	it("prints per-track comments as # lines, never the stale song-wide comment", () => {
		const track = buildTrack(10, 1);
		poke(track, 0, 0, 0, "1");
		const song = buildSong({
			measureCount: 1,
			tracks: [track],
			sections: [{ id: 1, name: "A", startMeasure: 0, comment: "slow here", trackComments: { 10: "palm mute" } }],
		});
		const text = buildExportText(song);
		expect(text).not.toContain("slow here");
		expect(text).toContain("# palm mute");
	});

	it("marks unset cells with dashes and note names in the margin", () => {
		const track = buildTrack(10, 1);
		poke(track, 0, 0, 0, "0");
		const text = buildExportText(buildSong({ measureCount: 1, tracks: [track] }));
		expect(text).toMatch(/E \|/); // top string label
		expect(text).toContain("-");
	});
});

describe("lyrics in the text export", () => {
	it("writes out passes sung with different words instead of folding them", () => {
		const track = buildTrack(10, 4);
		for (let m = 0; m < 4; m++) poke(track, m, 0, 0, String(m));
		const text = buildExportText(
			buildSong({
				measureCount: 4,
				tracks: [track],
				progression: [{ id: 100, sectionId: 1, repeat: 2 }],
				lyrics: {
					"100:0": [["hel-", "lo", "", "", "", "", "", ""]],
					"100:1": [["good", "", "", "bye", "", "", "", ""]],
				},
			}),
		);
		expect(text).not.toContain("x2");
		expect(text.match(/== Intro ==/g)).toHaveLength(1);
		expect(text).toMatch(/^ +hel- lo$/m);
		expect(text).toMatch(/^ +good +bye$/m);
	});
});

describe("lyric verses", () => {
	it("print a pass's words once when other passes repeat them", () => {
		const track = buildTrack(10, 4);
		for (let m = 0; m < 4; m++) poke(track, m, 0, 0, String(m));
		const row = [["la", "", "", "", "", "", "", ""]];
		const blocks = trackSheetSections(
			buildSong({
				measureCount: 4,
				tracks: [track],
				progression: [{ id: 100, sectionId: 1, repeat: 3 }],
				lyrics: { "100:0": row, "100:1": row, "100:2": row },
			}),
			track,
		);
		expect(blocks).toHaveLength(1);
		expect(blocks[0].repeats).toBe(3);
		expect(blocks[0].verses).toHaveLength(1);
	});
});
