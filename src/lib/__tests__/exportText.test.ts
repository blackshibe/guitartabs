import { describe, expect, it } from "vitest";
import { buildExportText } from "../exportText";
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
		const track = buildTrack(10, 2);
		poke(track, 0, 0, 0, "3");
		poke(track, 1, 0, 0, "3");
		const text = buildExportText(buildSong({ measureCount: 2, tracks: [track] }));
		expect(text).toContain("== Intro x2 ==");
	});

	it("folds consecutive identical sections into xN", () => {
		const track = buildTrack(10, 2);
		poke(track, 0, 0, 0, "7");
		poke(track, 1, 0, 0, "7");
		const song = buildSong({
			measureCount: 2,
			tracks: [track],
			sections: [
				{ id: 1, name: "Riff", startMeasure: 0 },
				{ id: 2, name: "Riff", startMeasure: 1 },
			],
		});
		expect(buildExportText(song)).toContain("== Riff x2 ==");
	});

	it("prints section and per-track comments as # lines", () => {
		const track = buildTrack(10, 1);
		poke(track, 0, 0, 0, "1");
		const song = buildSong({
			measureCount: 1,
			tracks: [track],
			sections: [{ id: 1, name: "A", startMeasure: 0, comment: "slow here", trackComments: { 10: "palm mute" } }],
		});
		const text = buildExportText(song);
		expect(text).toContain("# slow here");
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
