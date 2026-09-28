export interface StringTuning {
	noteIndex: number;
	octave: number;
}

export type Column = (string | null)[];
export type Measure = Column[];

/** Song-level audio layer, independent of tab tracks — e.g. a drums stem
 *  with no tabbed counterpart. Plays alongside the synth from measure 0. */
export interface SongStem {
	id: number;
	/** original filename, for display */
	name: string;
	/** audio/ogg or audio/mpeg */
	mime: string;
	/** base64 audio payload; audio starts at measure 0, constant tempo */
	data: string;
	/** playback mix gain 0–1; absent = 1 */
	volume?: number;
}

/** One strum stroke: "d" down (low string to high), "u" up. */
export type Stroke = "d" | "u";

/** A column's strum mark: 1–4 strokes splitting the column evenly, e.g. "d",
 *  "du", "dudu" (see lib/strum.ts). */
export type Strum = string;

/** strums[m][c] for one measure's columns; null = unmarked. */
export type StrumRow = (Strum | null)[];

export interface Track {
	id: number;
	name: string;
	tuning: StringTuning[];
	measures: Measure[];
	/** strum marks parallel to `measures` (lazily grown — shorter or absent
	 *  means unmarked); spliced with the measures everywhere */
	strums?: StrumRow[];
	/** playback mix gain 0–1; absent = 1 */
	volume?: number;
	/** backing-track audio replacing this track's synth: plays timeline-aligned
	 *  from measure 0 at song tempo, and the track's synth notes are muted */
	backing?: TrackBacking;
}

export interface TrackBacking {
	/** original filename, for display */
	name: string;
	/** audio/ogg or audio/mpeg */
	mime: string;
	/** base64 audio payload */
	data: string;
}

export interface Section {
	id: number;
	name: string;
	startMeasure: number;
	/** song-wide note */
	comment?: string;
	/** trackId → note shown only for that track */
	trackComments?: Record<number, string>;
	/** id of the section this one mirrors — every edit writes to all copies */
	linkTo?: number;
	/** index into SECTION_COLORS; absent = neutral */
	colorIndex?: number;
	/** tempo override while this section plays (to track a reference video
	 *  whose performance drifts); absent = the song bpm */
	bpm?: number;
}

export interface SectionRange extends Section {
	endMeasure: number;
}

/** One step of the arrangement: play this section this many times, here.
 *  The progression — not the section order on the measure timeline — decides
 *  what the grid renders and what playback walks. */
export interface ProgressionEntry {
	id: number;
	sectionId: number;
	/** how many consecutive times this module plays; always >= 1 */
	repeat: number;
}

export interface YoutubeSync {
	videoId: string;
	/** downbeat this anchor pins — column anchorMeasure*COLS_PER_MEASURE */
	anchorMeasure: number;
	anchorSeconds: number;
}

export interface Song {
	id: string;
	title: string;
	bpm: number;
	measureCount: number;
	sections: Section[];
	tracks: Track[];
	updatedAt: number;
	/** ordered arrangement over the sections; absent = each section once, timeline order */
	progression?: ProgressionEntry[];
	/** song-level audio layers, not tied to any tab track */
	stems?: SongStem[];
	/** measureNotes[m] — free-text annotation for that measure, shared across tracks; parallel to measureCount */
	measureNotes?: string[];
	/** bars of silence before the tab comes in — pure playback timing, no measures behind it; absent = 0 */
	leadInBars?: number;
	youtube?: YoutubeSync;
}

export interface CellPos {
	measure: number;
	column: number;
	stringIndex: number;
}

export interface RangeSelection {
	anchor: CellPos;
	focus: CellPos;
}

export interface Playhead {
	/** source-timeline measure being played */
	measure: number;
	column: number;
	/** which rendered progression slot it is being played in */
	slot: number;
}
