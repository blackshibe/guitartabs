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

export interface Track {
	id: number;
	name: string;
	tuning: StringTuning[];
	measures: Measure[];
	/** sectionId → bars this track loops within that section (unit < span); bars unit..span-1 mirror 0..unit-1 */
	loops?: Record<number, number>;
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
}

export interface SectionRange extends Section {
	endMeasure: number;
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
	/** song-level audio layers, not tied to any tab track */
	stems?: SongStem[];
	/** measureNotes[m] — free-text annotation for that measure, shared across tracks; parallel to measureCount */
	measureNotes?: string[];
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
	measure: number;
	column: number;
}
