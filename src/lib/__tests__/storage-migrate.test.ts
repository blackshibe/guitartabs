import { describe, expect, it } from "vitest";
import { migrateSong, parseSongsFile, parseSongsJson } from "../storage";
import { compressText } from "../lzw";
import type { Song, Track } from "../../types";
import { buildSong, buildTrack, poke } from "./helpers";

describe("parseSongsJson shapes", () => {
	it("accepts a single song", () => {
		expect(parseSongsJson(JSON.stringify(buildSong()))).toHaveLength(1);
	});

	it("accepts an array of songs", () => {
		const songs = parseSongsJson(JSON.stringify([buildSong(), buildSong({ id: "song-2" })]));
		expect(songs.map((song) => song.id)).toEqual(["song-1", "song-2"]);
	});

	it("accepts a library record keyed by id", () => {
		const library = { "song-1": buildSong(), "song-2": buildSong({ id: "song-2" }) };
		expect(parseSongsJson(JSON.stringify(library))).toHaveLength(2);
	});

	it("filters out non-song entries instead of failing", () => {
		const mixed = [buildSong(), { nope: true }, 42];
		expect(parseSongsJson(JSON.stringify(mixed))).toHaveLength(1);
	});

	it("throws when nothing in the file is a song", () => {
		expect(() => parseSongsJson('{"hello":"world"}')).toThrow();
		expect(() => parseSongsJson("[]")).toThrow();
	});
});

describe("parseSongsFile", () => {
	it("reads a compressed export", () => {
		const bytes = compressText(JSON.stringify(buildSong()));
		expect(parseSongsFile(bytes)[0].id).toBe("song-1");
	});

	it("reads legacy plain JSON (pretty-printed)", () => {
		const bytes = new TextEncoder().encode(JSON.stringify(buildSong(), null, 2));
		expect(parseSongsFile(bytes)[0].id).toBe("song-1");
	});
});

describe("legacy migrations", () => {
	it("moves the old per-track stem into backing and strips sampler fields", () => {
		const track = buildTrack(10, 4) as Track & Record<string, unknown>;
		track.stem = { name: "kenny.mp3", mime: "audio/mpeg", data: "aGk=" };
		track.sample = { name: "note.mp3", mime: "audio/mpeg", data: "aGk=", rootMidi: 40 };
		track.instrument = "guitar";
		const migrated = migrateSong(buildSong({ tracks: [track] }));
		expect(migrated.tracks[0].backing).toEqual({ name: "kenny.mp3", mime: "audio/mpeg", data: "aGk=" });
		expect("stem" in migrated.tracks[0]).toBe(false);
		expect("sample" in migrated.tracks[0]).toBe(false);
		expect("instrument" in migrated.tracks[0]).toBe(false);
	});

	it("never overwrites an existing backing with a legacy stem", () => {
		const track = buildTrack(10, 4) as Track & Record<string, unknown>;
		track.backing = { name: "new.mp3", mime: "audio/mpeg", data: "bmV3" };
		track.stem = { name: "old.mp3", mime: "audio/mpeg", data: "b2xk" };
		const migrated = migrateSong(buildSong({ tracks: [track] }));
		expect(migrated.tracks[0].backing?.name).toBe("new.mp3");
	});

	it("writes out the legacy global section repeat as real bars plus a loop", () => {
		const track = buildTrack(10, 2);
		poke(track, 0, 0, 0, "5");
		poke(track, 1, 0, 0, "6");
		const legacy = buildSong({
			measureCount: 2,
			tracks: [track],
			sections: [{ id: 1, name: "A", startMeasure: 0, repeat: 2 } as Song["sections"][number]],
		});
		const migrated = migrateSong(legacy);
		expect(migrated.measureCount).toBe(4);
		expect(migrated.tracks[0].measures[2][0][0]).toBe("5");
		expect(migrated.tracks[0].measures[3][0][0]).toBe("6");
		expect(migrated.tracks[0].loops).toEqual({ 1: 2 });
		expect("repeat" in migrated.sections[0]).toBe(false);
	});

	it("re-mirrors drifted linked sections on load", () => {
		const track = buildTrack(10, 4);
		poke(track, 0, 0, 0, "5");
		poke(track, 2, 0, 0, "9"); // drifted copy
		const song = buildSong({
			tracks: [track],
			sections: [
				{ id: 1, name: "A", startMeasure: 0 },
				{ id: 2, name: "A'", startMeasure: 2, linkTo: 1 },
			],
		});
		const migrated = migrateSong(song);
		expect(migrated.tracks[0].measures[2][0][0]).toBe("5");
		expect(migrated.sections[1].linkTo).toBe(1); // link kept, not stripped
	});

	it("re-mirrors drifted loop bars on load", () => {
		const track = buildTrack(10, 4);
		track.loops = { 1: 1 };
		poke(track, 0, 0, 0, "5");
		poke(track, 3, 0, 0, "8"); // drifted bar
		const migrated = migrateSong(buildSong({ tracks: [track] }));
		for (let measure = 1; measure < 4; measure++) expect(migrated.tracks[0].measures[measure][0][0]).toBe("5");
		expect(migrated.tracks[0].loops).toEqual({ 1: 1 }); // loop kept
	});

	it("passes an already-modern song through untouched in content", () => {
		const song = buildSong({ stems: [{ id: 50, name: "s.ogg", mime: "audio/ogg", data: "aGk=" }] });
		const migrated = migrateSong(song);
		expect(migrated.stems).toEqual(song.stems);
		expect(migrated.measureCount).toBe(4);
	});
});
