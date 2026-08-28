import type { Song, StringTuning, Track } from "../../types";
import { makeMeasures } from "../instruments";

/** Two strings (E4 on top, B3 below) keep test grids small and readable. */
export function smallTuning(): StringTuning[] {
	return [
		{ noteIndex: 4, octave: 4 },
		{ noteIndex: 11, octave: 3 },
	];
}

export function buildTrack(id: number, measureCount: number, name = `Track ${id}`): Track {
	return { id, name, tuning: smallTuning(), measures: makeMeasures(2, measureCount) };
}

/** One 2-string track, four measures, one section — explicit ids throughout. */
export function buildSong(overrides: Partial<Song> = {}): Song {
	return {
		id: "song-1",
		title: "Test Song",
		bpm: 120,
		measureCount: 4,
		sections: [{ id: 1, name: "Intro", startMeasure: 0, comment: "" }],
		tracks: [buildTrack(10, 4)],
		updatedAt: 0,
		...overrides,
	};
}

/** Write a fret value directly into a track (test setup only). */
export function poke(track: Track, measure: number, column: number, stringIndex: number, value: string | null): void {
	track.measures[measure][column][stringIndex] = value;
}
