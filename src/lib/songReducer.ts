import type {
	CellPos,
	StepLyrics,
	ProgressionEntry,
	Section,
	SectionRange,
	Song,
	SongStem,
	StringTuning,
	Strum,
	Track,
	TrackBacking,
	YoutubeSync,
} from "../types";
import { COLS_PER_MEASURE, makeMeasures, nextId } from "./instruments";
import type { CellClipboard, Rect, SectionClipboard } from "./clipboard";
import { entryIndexForSection, normalizeProgression } from "./progression";
import {
	dedupeSections,
	deepCopyMeasures,
	blankLyricRow,
	deleteMeasuresFromTrack,
	insertBlankMeasures,
	insertMeasuresIntoTrack,
	lyricKey,
	pruneStepLyrics,
	sectionRangesFor,
	spliceStepLyrics,
	stepLyricAt,
	strumAt,
	strumRowsFor,
	writeStrums,
} from "./songOps";

export interface SongState {
	id: string;
	title: string;
	bpm: number;
	measureCount: number;
	sections: Section[];
	/** the arrangement: which sections play, in what order, how many times */
	progression: ProgressionEntry[];
	tracks: Track[];
	/** measureNotes[m] — free-text annotation for that measure; parallel to the shared timeline, not per-track */
	measureNotes: string[];
	/** words per column, keyed by progression step + pass (see StepLyrics) */
	lyrics: StepLyrics;
	/** bars of silence before the tab comes in; absent = 0 */
	leadInBars?: number;
	youtube?: YoutubeSync;
	/** song-level audio layers, not tied to any tab track */
	stems: SongStem[];
	/** stale between saves — save paths stamp Date.now() when persisting */
	updatedAt: number;
}

export type SongAction =
	| { type: "set-title"; title: string }
	| { type: "set-bpm"; bpm: number }
	| { type: "set-section-bpm"; id: number; bpm: number | null }
	| { type: "set-cell"; trackId: number; measure: number; column: number; stringIndex: number; value: string | null }
	| { type: "set-strum"; trackId: number; measure: number; column: number; strum: Strum | null }
	| { type: "clear-range"; trackId: number; rect: Rect }
	| { type: "clear-strums"; trackId: number; rect: Rect }
	| { type: "paste-cells"; trackId: number; at: CellPos; clip: CellClipboard }
	| { type: "set-measure-note"; measure: number; text: string }
	| { type: "set-lyric"; entryId: number; pass: number; offset: number; column: number; text: string }
	| { type: "replace-lyrics"; lyrics: StepLyrics }
	| { type: "insert-measure"; after: number }
	| { type: "delete-measure"; measure: number }
	| { type: "add-section-at"; measure: number }
	| { type: "add-section-after"; measure: number }
	| { type: "set-lead-in"; bars: number }
	| { type: "rename-section"; id: number; name: string }
	| { type: "set-section-comment"; id: number; trackId?: number; text: string }
	| { type: "delete-section"; id: number }
	| { type: "paste-section"; at: number; clip: SectionClipboard }
	| { type: "link-section"; id: number; to: number }
	| { type: "unlink-section"; id: number }
	| { type: "set-section-color"; id: number; colorIndex?: number }
	| { type: "add-entry"; sectionId: number; at?: number }
	| { type: "remove-entry"; entryId: number }
	| { type: "move-entry"; entryId: number; direction: -1 | 1 }
	| { type: "set-entry-repeat"; entryId: number; repeat: number }
	| { type: "add-track"; track: Track }
	| { type: "remove-track"; id: number }
	| { type: "rename-track"; id: number; name: string }
	| { type: "set-track-tuning"; id: number; tuning: StringTuning[] }
	| { type: "set-track-volume"; id: number; volume: number }
	| { type: "set-track-backing"; id: number; backing: TrackBacking | null }
	| { type: "add-stem"; stem: SongStem }
	| { type: "remove-stem"; id: number }
	| { type: "set-stem-volume"; id: number; volume: number }
	| { type: "set-youtube-video"; videoId: string | null }
	| { type: "set-youtube-anchor"; measure: number; seconds: number }
	| { type: "load-song"; song: Song };

function updateTrack(state: SongState, trackId: number, updater: (t: Track) => Track): SongState {
	return { ...state, tracks: state.tracks.map((t) => (t.id === trackId ? updater(t) : t)) };
}

function rangesOf(state: SongState): SectionRange[] {
	return sectionRangesFor(state.sections, state.measureCount);
}

function rootIdOf(sec: Section): number {
	return sec.linkTo ?? sec.id;
}

// All timeline measures mirroring m, m first. Singleton unless m sits inside a
// linked group of 2+ sections — every content write goes to all of them, so
// linked sections never diverge.
function mirrorMeasures(ranges: SectionRange[], m: number): number[] {
	const sec = ranges.find((r) => m >= r.startMeasure && m <= r.endMeasure);
	if (!sec) return [m];
	const root = rootIdOf(sec);
	const group = ranges.filter((r) => rootIdOf(r) === root);
	if (group.length <= 1) return [m];
	const off = m - sec.startMeasure;
	// Structural edits can leave group members with unequal spans; a mirror
	// write past a shorter member's end would land in the next section's bars
	// (or off the timeline entirely), so those members are skipped.
	return [
		m,
		...group
			.filter((r) => r.id !== sec.id && r.startMeasure + off <= r.endMeasure)
			.map((r) => r.startMeasure + off),
	];
}

function spliceNotes(notes: string[], at: number, insert: string[]): string[] {
	const next = notes.slice();
	// The notes array is lazily grown, so it may be shorter than `at` — pad
	// first or the splice would land the inserted notes at the wrong measure.
	while (next.length < at) next.push("");
	next.splice(at, 0, ...insert);
	return next;
}

// Insert `count` blank measures at `at` in every track and shift markers.
// Every progression step that plays the section owning measure m, and m's
// offset into it — lyric rows are spliced per step.
function stepsPlaying(state: SongState, ranges: SectionRange[], m: number): { entryIds: Set<number>; offset: number } {
	const range = ranges.find((r) => m >= r.startMeasure && m <= r.endMeasure);
	if (!range) return { entryIds: new Set(), offset: 0 };
	const entryIds = new Set(state.progression.filter((e) => e.sectionId === range.id).map((e) => e.id));
	return { entryIds, offset: m - range.startMeasure };
}

// Insert `count` blank measures at `at` in every track and shift markers.
function insertBlankAt(state: SongState, at: number, count: number): SongState {
	const sections = state.sections.map((s) =>
		s.startMeasure >= at ? { ...s, startMeasure: s.startMeasure + count } : s,
	);
	const measureCount = state.measureCount + count;
	const { entryIds, offset } = stepsPlaying(state, sectionRangesFor(sections, measureCount), at);
	return {
		...state,
		tracks: state.tracks.map((t) => insertBlankMeasures(t, at, count)),
		measureCount,
		measureNotes: spliceNotes(state.measureNotes, at, Array(count).fill("")),
		lyrics: spliceStepLyrics(state.lyrics, entryIds, offset, count, 0),
		sections,
	};
}

// Fit clipboard columns to a track's string count.
function fitMeasuresTo(track: Track, measures: (string | null)[][][], span: number): Track["measures"] {
	const len = track.tuning.length;
	const fitted = measures.slice(0, span).map((measure) =>
		Array.from({ length: COLS_PER_MEASURE }, (_, c) => {
			const col = (measure[c] ?? []).slice(0, len);
			while (col.length < len) col.push(null);
			return col;
		}),
	);
	while (fitted.length < span) fitted.push(...makeMeasures(len, 1));
	return fitted;
}

// A new section joins the arrangement immediately, right after whatever
// already plays the section before it on the timeline — otherwise it would be
// invisible, since the grid renders the progression, not the raw timeline.
function withNewSectionEntry(
	progression: ProgressionEntry[],
	sections: Section[],
	sectionId: number,
	startMeasure: number,
): ProgressionEntry[] {
	const next = progression.slice();
	next.splice(entryIndexForSection(progression, sections, startMeasure), 0, {
		id: nextId(),
		sectionId,
		repeat: 1,
	});
	return next;
}

// Insert a copied/duplicated section block at timeline position `at`.
function insertSectionBlock(
	state: SongState,
	at: number,
	span: number,
	marker: Omit<Section, "id" | "startMeasure">,
	notes: string[] | undefined,
	trackContent: (t: Track, index: number) => Track["measures"],
	trackStrums?: (t: Track, index: number) => Track["strums"],
): SongState {
	const id = nextId();
	const sections = [
		...state.sections.map((s) => (s.startMeasure >= at ? { ...s, startMeasure: s.startMeasure + span } : s)),
		{ id, startMeasure: at, ...marker },
	];
	return {
		...state,
		tracks: state.tracks.map((t, i) => insertMeasuresIntoTrack(t, at, trackContent(t, i), trackStrums?.(t, i))),
		measureCount: state.measureCount + span,
		measureNotes: spliceNotes(state.measureNotes, at, notes ?? Array(span).fill("")),
		sections,
		progression: withNewSectionEntry(state.progression, sections, id, at),
	};
}

export function songReducer(state: SongState, action: SongAction): SongState {
	switch (action.type) {
		case "set-title":
			return state.title === action.title ? state : { ...state, title: action.title };

		case "set-bpm":
			return state.bpm === action.bpm ? state : { ...state, bpm: action.bpm };

		case "set-section-bpm": {
			const bpm = action.bpm !== null && Number.isFinite(action.bpm) && action.bpm >= 1 ? action.bpm : undefined;
			const section = state.sections.find((s) => s.id === action.id);
			if (!section || section.bpm === bpm) return state;
			return {
				...state,
				sections: state.sections.map((s) => (s.id === action.id ? { ...s, bpm } : s)),
			};
		}

		case "set-cell": {
			const { trackId, measure: m, column: c, stringIndex: s, value } = action;
			const track = state.tracks.find((t) => t.id === trackId);
			if (!track || m < 0 || m >= state.measureCount || s < 0 || s >= track.tuning.length) return state;
			const positions = mirrorMeasures(rangesOf(state), m);
			return updateTrack(state, trackId, (t) => {
				const measures = deepCopyMeasures(t.measures);
				positions.forEach((p) => {
					measures[p][c][s] = value;
				});
				return { ...t, measures };
			});
		}

		case "set-strum": {
			const { trackId, measure: m, column: c, strum } = action;
			const track = state.tracks.find((t) => t.id === trackId);
			if (!track || m < 0 || m >= state.measureCount || c < 0 || c >= COLS_PER_MEASURE) return state;
			if (strumAt(track, m, c) === strum) return state;
			const writes = mirrorMeasures(rangesOf(state), m).map((p) => ({ measure: p, column: c, strum }));
			return updateTrack(state, trackId, (t) => writeStrums(t, writes));
		}

		// Only the strum marks of the rect's columns — the frets stay.
		case "clear-strums": {
			const { trackId, rect } = action;
			const track = state.tracks.find((t) => t.id === trackId);
			if (!track) return state;
			const ranges = rangesOf(state);
			const writes: { measure: number; column: number; strum: null }[] = [];
			for (let g = rect.startColumn; g <= rect.endColumn; g++) {
				const m = Math.floor(g / COLS_PER_MEASURE);
				const c = g % COLS_PER_MEASURE;
				if (m < 0 || m >= state.measureCount) continue;
				mirrorMeasures(ranges, m).forEach((p) => {
					if (strumAt(track, p, c) !== null) writes.push({ measure: p, column: c, strum: null });
				});
			}
			if (writes.length === 0) return state;
			return updateTrack(state, trackId, (t) => writeStrums(t, writes));
		}

		case "clear-range": {
			const { trackId, rect } = action;
			const track = state.tracks.find((t) => t.id === trackId);
			if (!track) return state;
			const ranges = rangesOf(state);
			// Strum marks go too when the range is whole columns, or when it holds
			// no frets at all — then the marks are the only thing to delete.
			const wholeColumns = rect.startString <= 0 && rect.endString >= track.tuning.length - 1;
			let holdsFrets = false;
			for (let g = rect.startColumn; g <= rect.endColumn && !holdsFrets; g++) {
				const column = track.measures[Math.floor(g / COLS_PER_MEASURE)]?.[g % COLS_PER_MEASURE] ?? [];
				for (let s = rect.startString; s <= rect.endString; s++) {
					if (column[s] !== null && column[s] !== undefined && column[s] !== "") holdsFrets = true;
				}
			}
			const clearStrums = wholeColumns || !holdsFrets;
			return updateTrack(state, trackId, (t) => {
				const measures = deepCopyMeasures(t.measures);
				const endString = Math.min(rect.endString, t.tuning.length - 1);
				const strumWrites: { measure: number; column: number; strum: null }[] = [];
				for (let g = rect.startColumn; g <= rect.endColumn; g++) {
					const m = Math.floor(g / COLS_PER_MEASURE);
					const c = g % COLS_PER_MEASURE;
					if (m < 0 || m >= state.measureCount) continue;
					mirrorMeasures(ranges, m).forEach((p) => {
						for (let s = rect.startString; s <= endString; s++) measures[p][c][s] = null;
						if (clearStrums && strumAt(t, p, c) !== null) strumWrites.push({ measure: p, column: c, strum: null });
					});
				}
				const cleared = { ...t, measures };
				return strumWrites.length > 0 ? writeStrums(cleared, strumWrites) : cleared;
			});
		}

		case "paste-cells": {
			const { trackId, at, clip } = action;
			const track = state.tracks.find((t) => t.id === trackId);
			if (!track) return state;
			const startCol = at.measure * COLS_PER_MEASURE + at.column;
			const maxCol = state.measureCount * COLS_PER_MEASURE - 1;
			const ranges = rangesOf(state);
			return updateTrack(state, trackId, (t) => {
				const measures = deepCopyMeasures(t.measures);
				const strumWrites: { measure: number; column: number; strum: Strum | null }[] = [];
				for (let i = 0; i < clip.cols; i++) {
					const g = startCol + i;
					if (g > maxCol) break;
					const m = Math.floor(g / COLS_PER_MEASURE);
					const c = g % COLS_PER_MEASURE;
					mirrorMeasures(ranges, m).forEach((p) => {
						for (let r = 0; r < clip.rows; r++) {
							const s = at.stringIndex + r;
							if (s >= t.tuning.length) break;
							measures[p][c][s] = clip.data[r][i] ?? null;
						}
						// Whole-column copies carry their strum marks.
						if (clip.strums) strumWrites.push({ measure: p, column: c, strum: clip.strums[i] ?? null });
					});
				}
				const pasted = { ...t, measures };
				return strumWrites.length > 0 ? writeStrums(pasted, strumWrites) : pasted;
			});
		}

		case "set-measure-note": {
			const { measure: m, text } = action;
			if (m < 0 || m >= state.measureCount) return state;
			const positions = mirrorMeasures(rangesOf(state), m);
			const notes = state.measureNotes.slice();
			while (notes.length < state.measureCount) notes.push("");
			positions.forEach((p) => {
				notes[p] = text;
			});
			return { ...state, measureNotes: notes };
		}

		case "set-lyric": {
			const { entryId, pass, offset, column } = action;
			const entry = state.progression.find((e) => e.id === entryId);
			const range = entry && rangesOf(state).find((r) => r.id === entry.sectionId);
			if (!entry || !range || pass < 0 || pass >= entry.repeat) return state;
			if (offset < 0 || offset > range.endMeasure - range.startMeasure) return state;
			if (column < 0 || column >= COLS_PER_MEASURE) return state;
			const text = action.text.trim();
			if (stepLyricAt(state.lyrics, entryId, pass, offset, column) === text) return state;
			const key = lyricKey(entryId, pass);
			const rows = (state.lyrics[key] ?? []).map((row) => row.slice());
			while (rows.length <= offset) rows.push(blankLyricRow());
			rows[offset][column] = text;
			return { ...state, lyrics: { ...state.lyrics, [key]: rows } };
		}

		case "replace-lyrics":
			return { ...state, lyrics: action.lyrics };

		case "insert-measure": {
			const at = action.after + 1;
			return insertBlankAt(state, at, 1);
		}

		case "delete-measure": {
			const { measure: m } = action;
			if (state.measureCount <= 1 || m < 0 || m >= state.measureCount) return state;
			const newCount = state.measureCount - 1;
			const shifted = state.sections
				.map((s) => (s.startMeasure > m ? { ...s, startMeasure: s.startMeasure - 1 } : s))
				.map((s) => (s.startMeasure >= newCount ? { ...s, startMeasure: newCount - 1 } : s));
			const deduped = dedupeSections(shifted).sort((a, b) => a.startMeasure - b.startMeasure);
			if (deduped[0].startMeasure !== 0) deduped[0] = { ...deduped[0], startMeasure: 0 };
			// dedupeSections may have dropped a section other members linked to.
			const surviving = new Set(deduped.map((s) => s.id));
			const cleaned = deduped.map((s) =>
				s.linkTo !== undefined && !surviving.has(s.linkTo) ? { ...s, linkTo: undefined } : s,
			);
			return {
				...state,
				tracks: state.tracks.map((t) => deleteMeasuresFromTrack(t, new Set([m]))),
				measureCount: newCount,
				measureNotes: state.measureNotes.filter((_, i) => i !== m),
				lyrics: (() => {
					const { entryIds, offset } = stepsPlaying(state, rangesOf(state), m);
					return spliceStepLyrics(state.lyrics, entryIds, offset, 0, 1);
				})(),
				sections: cleaned,
				// A collapsed duplicate section takes its arrangement steps with it.
				progression: normalizeProgression(state.progression, cleaned),
			};
		}

		case "add-section-at": {
			const { measure: m } = action;
			if (m < 0 || m >= state.measureCount) return state;
			if (state.sections.some((s) => s.startMeasure === m)) return state;
			const id = nextId();
			return {
				...state,
				sections: [...state.sections, { id, name: "New Section", startMeasure: m, comment: "" }],
				progression: withNewSectionEntry(state.progression, state.sections, id, m),
			};
		}

		case "add-section-after": {
			const { measure: m } = action;
			const collision = state.sections.some((s) => s.startMeasure === m);
			if (m >= state.measureCount || collision) {
				const grown = insertBlankAt(state, m, 1);
				const id = nextId();
				return {
					...grown,
					sections: [...grown.sections, { id, name: "New Section", startMeasure: m, comment: "" }],
					progression: withNewSectionEntry(grown.progression, grown.sections, id, m),
				};
			}
			return songReducer(state, { type: "add-section-at", measure: m });
		}

		case "set-lead-in": {
			const bars = Math.max(0, Math.min(64, action.bars));
			return (state.leadInBars ?? 0) === bars ? state : { ...state, leadInBars: bars };
		}

		case "rename-section":
			return {
				...state,
				sections: state.sections.map((s) => (s.id === action.id ? { ...s, name: action.name } : s)),
			};

		case "set-section-comment": {
			const { id, trackId, text } = action;
			return {
				...state,
				sections: state.sections.map((s) => {
					if (s.id !== id) return s;
					if (trackId == null) return { ...s, comment: text };
					return { ...s, trackComments: { ...(s.trackComments ?? {}), [trackId]: text } };
				}),
			};
		}

		// Deletes the section AND its bars. There is no marker-only removal: a
		// bare marker delete just merged the bars into the section above, which
		// is never what "delete this part of the song" means.
		case "delete-section": {
			const range = rangesOf(state).find((r) => r.id === action.id);
			if (!range || state.sections.length <= 1) return state;
			const span = range.endMeasure - range.startMeasure + 1;
			if (state.measureCount - span < 1) return state;
			const drop = new Set<number>();
			for (let m = range.startMeasure; m <= range.endMeasure; m++) drop.add(m);
			const next = state.sections
				.filter((s) => s.id !== action.id)
				.map((s) => (s.linkTo === action.id ? { ...s, linkTo: undefined } : s))
				.map((s) => (s.startMeasure > range.endMeasure ? { ...s, startMeasure: s.startMeasure - span } : s))
				.sort((a, b) => a.startMeasure - b.startMeasure);
			if (next[0].startMeasure !== 0) next[0] = { ...next[0], startMeasure: 0 };
			const progression = normalizeProgression(state.progression, next);
			return {
				...state,
				tracks: state.tracks.map((t) => deleteMeasuresFromTrack(t, drop)),
				measureCount: state.measureCount - span,
				measureNotes: state.measureNotes.filter((_, i) => !drop.has(i)),
				sections: next,
				progression,
				lyrics: pruneStepLyrics(state.lyrics, new Set(progression.map((e) => e.id))),
			};
		}

		case "link-section": {
			const { id, to } = action;
			if (id === to) return state;
			const source = state.sections.find((s) => s.id === to);
			if (!source || !state.sections.some((s) => s.id === id)) return state;
			const ranges = rangesOf(state);
			const targetRange = ranges.find((r) => r.id === id);
			const sourceRange = ranges.find((r) => r.id === to);
			if (!targetRange || !sourceRange) return state;
			const span = targetRange.endMeasure - targetRange.startMeasure + 1;
			if (span !== sourceRange.endMeasure - sourceRange.startMeasure + 1) return state;
			const rootId = rootIdOf(source);
			const tracks = state.tracks.map((t) => {
				const measures = deepCopyMeasures(t.measures);
				for (let off = 0; off < span; off++) {
					measures[targetRange.startMeasure + off] = measures[sourceRange.startMeasure + off].map((col) =>
						col.slice(),
					);
				}
				if (!t.strums) return { ...t, measures };
				const strumWrites = strumRowsFor(t, sourceRange.startMeasure, sourceRange.endMeasure).flatMap((row, off) =>
					row.map((strum, column) => ({ measure: targetRange.startMeasure + off, column, strum })),
				);
				return writeStrums({ ...t, measures }, strumWrites);
			});
			const groupColor =
				source.colorIndex ?? ranges.find((r) => rootIdOf(r) === rootId && r.colorIndex != null)?.colorIndex;
			const usedColors = new Set(state.sections.map((s) => s.colorIndex).filter((c): c is number => c != null));
			const nextColor = groupColor ?? Array.from({ length: 8 }, (_, i) => i).find((i) => !usedColors.has(i)) ?? 0;
			const rootAlreadyColored = ranges.find((r) => r.id === rootId)?.colorIndex != null;
			const sections = state.sections.map((s) => {
				if (s.id === id) return { ...s, linkTo: rootId, colorIndex: nextColor };
				if (s.id === rootId && !rootAlreadyColored) return { ...s, colorIndex: nextColor };
				return s;
			});
			return { ...state, tracks, sections };
		}

		case "unlink-section": {
			const { id } = action;
			if (!state.sections.some((s) => s.id === id && s.linkTo != null)) return state;
			return { ...state, sections: state.sections.map((s) => (s.id === id ? { ...s, linkTo: undefined } : s)) };
		}

		case "add-entry": {
			if (!state.sections.some((s) => s.id === action.sectionId)) return state;
			const entry: ProgressionEntry = { id: nextId(), sectionId: action.sectionId, repeat: 1 };
			const progression = state.progression.slice();
			progression.splice(action.at ?? progression.length, 0, entry);
			return { ...state, progression };
		}

		case "remove-entry": {
			// The last step can't go — an empty arrangement would render nothing.
			if (state.progression.length <= 1) return state;
			if (!state.progression.some((e) => e.id === action.entryId)) return state;
			const progression = state.progression.filter((e) => e.id !== action.entryId);
			return {
				...state,
				progression,
				lyrics: pruneStepLyrics(state.lyrics, new Set(progression.map((e) => e.id))),
			};
		}

		case "move-entry": {
			const from = state.progression.findIndex((e) => e.id === action.entryId);
			const to = from + action.direction;
			if (from === -1 || to < 0 || to >= state.progression.length) return state;
			const progression = state.progression.slice();
			[progression[from], progression[to]] = [progression[to], progression[from]];
			return { ...state, progression };
		}

		case "set-entry-repeat": {
			const repeat = Math.max(1, Math.min(64, Math.floor(action.repeat)));
			const entry = state.progression.find((e) => e.id === action.entryId);
			if (!entry || entry.repeat === repeat) return state;
			return {
				...state,
				progression: state.progression.map((e) => (e.id === action.entryId ? { ...e, repeat } : e)),
			};
		}

		case "set-section-color":
			return {
				...state,
				sections: state.sections.map((s) => (s.id === action.id ? { ...s, colorIndex: action.colorIndex } : s)),
			};

		case "paste-section": {
			const { at, clip } = action;
			if (clip.span < 1 || at < 0 || at > state.measureCount) return state;
			const trackComments: Record<number, string> = {};
			state.tracks.forEach((t, i) => {
				const text = clip.trackComments?.[i];
				if (text) trackComments[t.id] = text;
			});
			return insertSectionBlock(
				state,
				at,
				clip.span,
				{
					name: clip.name,
					comment: clip.comment,
					trackComments: Object.keys(trackComments).length ? trackComments : undefined,
				},
				clip.measureNotes,
				(t, i) => {
					const payload = clip.tracks[i];
					if (!payload) return makeMeasures(t.tuning.length, clip.span);
					return fitMeasuresTo(t, payload.measures, clip.span);
				},
				(_, i) => clip.tracks[i]?.strums,
			);
		}

		case "add-track":
			// The track is built by the caller so it can activate the new id.
			return { ...state, tracks: [...state.tracks, action.track] };

		case "remove-track": {
			if (state.tracks.length <= 1 || !state.tracks.some((t) => t.id === action.id)) return state;
			return { ...state, tracks: state.tracks.filter((t) => t.id !== action.id) };
		}

		case "rename-track":
			return updateTrack(state, action.id, (t) => ({ ...t, name: action.name }));

		case "set-track-tuning": {
			const track = state.tracks.find((t) => t.id === action.id);
			if (!track) return state;
			return updateTrack(state, action.id, (t) => {
				const len = action.tuning.length;
				const measures = t.measures.map((measure) =>
					measure.map((col) => {
						const next = col.slice(0, len);
						while (next.length < len) next.push(null);
						return next;
					}),
				);
				return { ...t, tuning: action.tuning, measures };
			});
		}

		case "add-stem":
			// The stem is built by the caller (file decode is async).
			return { ...state, stems: [...state.stems, action.stem] };

		case "remove-stem":
			if (!state.stems.some((s) => s.id === action.id)) return state;
			return { ...state, stems: state.stems.filter((s) => s.id !== action.id) };

		case "set-stem-volume":
			return {
				...state,
				stems: state.stems.map((s) =>
					s.id === action.id ? { ...s, volume: Math.max(0, Math.min(1, action.volume)) } : s,
				),
			};

		case "set-track-volume":
			return updateTrack(state, action.id, (t) => ({ ...t, volume: Math.max(0, Math.min(1, action.volume)) }));

		case "set-track-backing":
			return updateTrack(state, action.id, (t) => {
				const { backing: _backing, ...rest } = t;
				return action.backing ? { ...rest, backing: action.backing } : rest;
			});

		case "set-youtube-video":
			if (!action.videoId) return state.youtube ? { ...state, youtube: undefined } : state;
			return {
				...state,
				youtube: {
					videoId: action.videoId,
					anchorMeasure: state.youtube?.anchorMeasure ?? 0,
					anchorSeconds: state.youtube?.anchorSeconds ?? 0,
				},
			};

		case "set-youtube-anchor":
			if (!state.youtube) return state;
			return {
				...state,
				youtube: { ...state.youtube, anchorMeasure: action.measure, anchorSeconds: action.seconds },
			};

		case "load-song": {
			const { song } = action;
			return {
				id: song.id,
				title: song.title,
				bpm: song.bpm,
				measureCount: song.measureCount,
				sections: song.sections,
				progression: normalizeProgression(song.progression, song.sections),
				tracks: song.tracks,
				measureNotes: song.measureNotes ?? [],
				// an array is the short-lived per-measure shape; storage migrates it
				lyrics: song.lyrics && !Array.isArray(song.lyrics) ? song.lyrics : {},
				leadInBars: song.leadInBars,
				youtube: song.youtube,
				stems: song.stems ?? [],
				updatedAt: song.updatedAt,
			};
		}
	}
}

// ---- undo history ----

export interface SongHistory {
	past: SongState[];
	present: SongState;
	future: SongState[];
	lastCoalesce: string | null;
}

export type HistoryAction = SongAction | { type: "undo" } | { type: "redo" };

const HISTORY_CAP = 100;

// Consecutive actions sharing a key collapse into one undo step
// (typing "1" then "2" into a cell undoes as one edit).
function coalesceKey(action: SongAction): string | null {
	switch (action.type) {
		case "set-title":
			return "title";
		case "set-bpm":
			return "bpm";
		case "set-section-bpm":
			return `sec-bpm:${action.id}`;
		case "set-cell":
			return `cell:${action.trackId}:${action.measure}:${action.column}:${action.stringIndex}`;
		case "set-measure-note":
			return `measure-note:${action.measure}`;
		case "set-lyric":
			return `lyric:${action.entryId}:${action.pass}:${action.offset}:${action.column}`;
		case "rename-section":
			return `sec-name:${action.id}`;
		case "set-section-comment":
			return `sec-comment:${action.id}:${action.trackId ?? "song"}`;
		case "rename-track":
			return `track-name:${action.id}`;
		case "set-track-volume":
			return `track-volume:${action.id}`;
		case "set-stem-volume":
			return `stem-volume:${action.id}`;
		case "set-entry-repeat":
			return `entry-repeat:${action.entryId}`;
		default:
			return null;
	}
}

export function initHistory(song: Song): SongHistory {
	return {
		past: [],
		present: songReducer({} as SongState, { type: "load-song", song }),
		future: [],
		lastCoalesce: null,
	};
}

export function historyReducer(h: SongHistory, action: HistoryAction): SongHistory {
	if (action.type === "undo") {
		if (h.past.length === 0) return h;
		const previous = h.past[h.past.length - 1];
		return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future], lastCoalesce: null };
	}
	if (action.type === "redo") {
		if (h.future.length === 0) return h;
		const [next, ...rest] = h.future;
		return { past: [...h.past, h.present], present: next, future: rest, lastCoalesce: null };
	}
	if (action.type === "load-song") {
		return { past: [], present: songReducer(h.present, action), future: [], lastCoalesce: null };
	}
	const next = songReducer(h.present, action);
	if (next === h.present) return h;
	const key = coalesceKey(action);
	if (key !== null && key === h.lastCoalesce) {
		return { ...h, present: next };
	}
	const past = [...h.past, h.present].slice(-HISTORY_CAP);
	return { past, present: next, future: [], lastCoalesce: key };
}
