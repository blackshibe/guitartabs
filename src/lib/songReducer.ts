import type {
	CellPos,
	Section,
	SectionRange,
	Song,
	SongStem,
	StringTuning,
	Track,
	TrackBacking,
	YoutubeSync,
} from "../types";
import { COLS_PER_MEASURE, makeMeasures, nextId } from "./instruments";
import type { CellClipboard, Rect, SectionClipboard } from "./clipboard";
import {
	dedupeSections,
	deepCopyMeasures,
	deleteMeasuresFromTrack,
	insertBlankMeasures,
	insertMeasuresIntoTrack,
	sectionRangesFor,
} from "./songOps";

export interface SongState {
	id: string;
	title: string;
	bpm: number;
	measureCount: number;
	sections: Section[];
	tracks: Track[];
	/** measureNotes[m] — free-text annotation for that measure; parallel to the shared timeline, not per-track */
	measureNotes: string[];
	youtube?: YoutubeSync;
	/** song-level audio layers, not tied to any tab track */
	stems: SongStem[];
	/** stale between saves — save paths stamp Date.now() when persisting */
	updatedAt: number;
}

export type SongAction =
	| { type: "set-title"; title: string }
	| { type: "set-bpm"; bpm: number }
	| { type: "set-cell"; trackId: number; measure: number; column: number; stringIndex: number; value: string | null }
	| { type: "clear-range"; trackId: number; rect: Rect }
	| { type: "paste-cells"; trackId: number; at: CellPos; clip: CellClipboard }
	| { type: "set-measure-note"; measure: number; text: string }
	| { type: "insert-measure"; after: number }
	| { type: "delete-measure"; measure: number }
	| { type: "add-section-at"; measure: number }
	| { type: "add-section-after"; measure: number }
	| { type: "rename-section"; id: number; name: string }
	| { type: "set-section-comment"; id: number; trackId?: number; text: string }
	| { type: "delete-section"; id: number }
	| { type: "paste-section"; at: number; clip: SectionClipboard }
	| { type: "link-section"; id: number; to: number }
	| { type: "unlink-section"; id: number }
	| { type: "set-track-loop"; trackId: number; sectionId: number; unit: number | null }
	| { type: "set-section-color"; id: number; colorIndex?: number }
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
	return [m, ...group.filter((r) => r.id !== sec.id).map((r) => r.startMeasure + off)];
}

// This one track's own repeat positions inside its loop unit for whichever
// section m sits in. Singleton unless the track loops that section.
function trackLoopMirror(track: Track, ranges: SectionRange[], m: number): number[] {
	const sec = ranges.find((r) => m >= r.startMeasure && m <= r.endMeasure);
	if (!sec) return [m];
	const span = sec.endMeasure - sec.startMeasure + 1;
	const unit = track.loops?.[sec.id];
	if (!unit || unit < 1 || unit >= span) return [m];
	const off = (m - sec.startMeasure) % unit;
	const mirrors: number[] = [];
	for (let o = off; o < span; o += unit) mirrors.push(sec.startMeasure + o);
	return mirrors;
}

// Closure over both mirror sources: an edit at m may fan out across a linked
// section (all tracks) and/or this track's own loop unit (that track only),
// and either can chain into the other, so this expands until stable.
function resolveMirrorSet(ranges: SectionRange[], track: Track, start: number): number[] {
	const seen = new Set<number>([start]);
	const stack = [start];
	while (stack.length) {
		const m = stack.pop() as number;
		for (const p of mirrorMeasures(ranges, m)) {
			if (!seen.has(p)) {
				seen.add(p);
				stack.push(p);
			}
		}
		for (const p of trackLoopMirror(track, ranges, m)) {
			if (!seen.has(p)) {
				seen.add(p);
				stack.push(p);
			}
		}
	}
	return [...seen];
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
function insertBlankAt(state: SongState, at: number, count: number): SongState {
	return {
		...state,
		tracks: state.tracks.map((t) => insertBlankMeasures(t, at, count)),
		measureCount: state.measureCount + count,
		measureNotes: spliceNotes(state.measureNotes, at, Array(count).fill("")),
		sections: state.sections.map((s) =>
			s.startMeasure >= at ? { ...s, startMeasure: s.startMeasure + count } : s,
		),
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

// Insert a copied/duplicated section block at timeline position `at`.
function insertSectionBlock(
	state: SongState,
	at: number,
	span: number,
	marker: Omit<Section, "id" | "startMeasure">,
	notes: string[] | undefined,
	trackContent: (t: Track, index: number) => Track["measures"],
): SongState {
	return {
		...state,
		tracks: state.tracks.map((t, i) => insertMeasuresIntoTrack(t, at, trackContent(t, i))),
		measureCount: state.measureCount + span,
		measureNotes: spliceNotes(state.measureNotes, at, notes ?? Array(span).fill("")),
		sections: [
			...state.sections.map((s) => (s.startMeasure >= at ? { ...s, startMeasure: s.startMeasure + span } : s)),
			{ id: nextId(), startMeasure: at, ...marker },
		],
	};
}

export function songReducer(state: SongState, action: SongAction): SongState {
	switch (action.type) {
		case "set-title":
			return state.title === action.title ? state : { ...state, title: action.title };

		case "set-bpm":
			return state.bpm === action.bpm ? state : { ...state, bpm: action.bpm };

		case "set-cell": {
			const { trackId, measure: m, column: c, stringIndex: s, value } = action;
			const track = state.tracks.find((t) => t.id === trackId);
			if (!track || m < 0 || m >= state.measureCount || s < 0 || s >= track.tuning.length) return state;
			const positions = resolveMirrorSet(rangesOf(state), track, m);
			return updateTrack(state, trackId, (t) => {
				const measures = deepCopyMeasures(t.measures);
				positions.forEach((p) => {
					measures[p][c][s] = value;
				});
				return { ...t, measures };
			});
		}

		case "clear-range": {
			const { trackId, rect } = action;
			const track = state.tracks.find((t) => t.id === trackId);
			if (!track) return state;
			const ranges = rangesOf(state);
			return updateTrack(state, trackId, (t) => {
				const measures = deepCopyMeasures(t.measures);
				const endString = Math.min(rect.endString, t.tuning.length - 1);
				for (let g = rect.startColumn; g <= rect.endColumn; g++) {
					const m = Math.floor(g / COLS_PER_MEASURE);
					const c = g % COLS_PER_MEASURE;
					if (m < 0 || m >= state.measureCount) continue;
					resolveMirrorSet(ranges, t, m).forEach((p) => {
						for (let s = rect.startString; s <= endString; s++) measures[p][c][s] = null;
					});
				}
				return { ...t, measures };
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
				for (let i = 0; i < clip.cols; i++) {
					const g = startCol + i;
					if (g > maxCol) break;
					const m = Math.floor(g / COLS_PER_MEASURE);
					const c = g % COLS_PER_MEASURE;
					resolveMirrorSet(ranges, t, m).forEach((p) => {
						for (let r = 0; r < clip.rows; r++) {
							const s = at.stringIndex + r;
							if (s >= t.tuning.length) break;
							measures[p][c][s] = clip.data[r][i] ?? null;
						}
					});
				}
				return { ...t, measures };
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
			const newRanges = sectionRangesFor(deduped, newCount);
			return {
				...state,
				tracks: state.tracks.map((t) => {
					const track = deleteMeasuresFromTrack(t, new Set([m]));
					if (!track.loops) return track;
					const loops = { ...track.loops };
					let changed = false;
					for (const key of Object.keys(loops)) {
						const sectionId = Number(key);
						const range = newRanges.find((r) => r.id === sectionId);
						const span = range ? range.endMeasure - range.startMeasure + 1 : 0;
						if (!range || loops[sectionId] >= span) {
							delete loops[sectionId];
							changed = true;
						}
					}
					return changed ? { ...track, loops } : track;
				}),
				measureCount: newCount,
				measureNotes: state.measureNotes.filter((_, i) => i !== m),
				sections: deduped,
			};
		}

		case "add-section-at": {
			const { measure: m } = action;
			if (m < 0 || m >= state.measureCount) return state;
			if (state.sections.some((s) => s.startMeasure === m)) return state;
			return {
				...state,
				sections: [...state.sections, { id: nextId(), name: "New Section", startMeasure: m, comment: "" }],
			};
		}

		case "add-section-after": {
			const { measure: m } = action;
			const collision = state.sections.some((s) => s.startMeasure === m);
			if (m >= state.measureCount || collision) {
				const grown = insertBlankAt(state, m, 1);
				return {
					...grown,
					sections: [...grown.sections, { id: nextId(), name: "New Section", startMeasure: m, comment: "" }],
				};
			}
			return songReducer(state, { type: "add-section-at", measure: m });
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

		case "delete-section": {
			if (state.sections.length <= 1 || !state.sections.some((s) => s.id === action.id)) return state;
			const next = state.sections
				.filter((s) => s.id !== action.id)
				.map((s) => (s.linkTo === action.id ? { ...s, linkTo: undefined } : s))
				.sort((a, b) => a.startMeasure - b.startMeasure);
			if (next[0].startMeasure !== 0) next[0] = { ...next[0], startMeasure: 0 };
			const tracks = state.tracks.map((t) => {
				if (!t.loops || !(action.id in t.loops)) return t;
				const loops = { ...t.loops };
				delete loops[action.id];
				return { ...t, loops };
			});
			return { ...state, sections: next, tracks };
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
				return { ...t, measures };
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

		case "set-track-loop": {
			const { trackId, sectionId, unit } = action;
			const track = state.tracks.find((t) => t.id === trackId);
			if (!track) return state;
			const range = rangesOf(state).find((r) => r.id === sectionId);
			if (!range) return state;
			const span = range.endMeasure - range.startMeasure + 1;
			if (unit == null) {
				if (!track.loops || !(sectionId in track.loops)) return state;
				return updateTrack(state, trackId, (t) => {
					const loops = { ...t.loops };
					delete loops[sectionId];
					return { ...t, loops };
				});
			}
			if (unit < 1 || unit >= span) return state;
			return updateTrack(state, trackId, (t) => {
				const measures = deepCopyMeasures(t.measures);
				for (let off = unit; off < span; off++) {
					measures[range.startMeasure + off] = measures[range.startMeasure + (off % unit)].map((col) =>
						col.slice(),
					);
				}
				return { ...t, measures, loops: { ...t.loops, [sectionId]: unit } };
			});
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
				tracks: song.tracks,
				measureNotes: song.measureNotes ?? [],
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
		case "set-cell":
			return `cell:${action.trackId}:${action.measure}:${action.column}:${action.stringIndex}`;
		case "set-measure-note":
			return `measure-note:${action.measure}`;
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
