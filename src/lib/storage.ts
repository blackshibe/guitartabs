import type { ProgressionEntry, Section, Song, Track } from "../types";
import { advanceIdCounter, makeMeasure, nextId } from "./instruments";
import { normalizeProgression } from "./progression";
import { blankStrumRow, sectionRangesFor } from "./songOps";
import { normalizeStrum } from "./strum";
import { compressText, decompressText, isCompressedExport } from "./lzw";

// Songs live in IndexedDB — localStorage's ~5MB quota can't hold stem audio.
// Tiny metadata (last-opened id, manual order) stays in localStorage. The old
// localStorage library is migrated into IndexedDB once on first open, then
// removed so it stops eating quota.
const DB_NAME = "tab-editor";
const STORE = "songs";
const LEGACY_LIBRARY_KEY = "tab-editor:songs";
const LAST_OPENED_KEY = "tab-editor:last-opened";
const ORDER_KEY = "tab-editor:song-order";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	if (!dbPromise) {
		dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
			const req = indexedDB.open(DB_NAME, 1);
			req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		}).then(migrateFromLocalStorage);
	}
	return dbPromise;
}

async function migrateFromLocalStorage(db: IDBDatabase): Promise<IDBDatabase> {
	const raw = localStorage.getItem(LEGACY_LIBRARY_KEY);
	if (!raw) return db;
	try {
		const lib = JSON.parse(raw) as Record<string, Song>;
		const tx = db.transaction(STORE, "readwrite");
		Object.values(lib)
			.filter(isSong)
			.forEach((s) => tx.objectStore(STORE).put(s));
		await txDone(tx);
		localStorage.removeItem(LEGACY_LIBRARY_KEY);
	} catch {
		// Leave the legacy key in place if migration fails — nothing is lost.
	}
	return db;
}

function txDone(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

function request<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function readAll(): Promise<Song[]> {
	const db = await openDb();
	return request(db.transaction(STORE).objectStore(STORE).getAll() as IDBRequest<Song[]>);
}

async function readOne(id: string): Promise<Song | undefined> {
	const db = await openDb();
	return request(db.transaction(STORE).objectStore(STORE).get(id) as IDBRequest<Song | undefined>);
}

export async function saveSong(song: Song): Promise<void> {
	const db = await openDb();
	const tx = db.transaction(STORE, "readwrite");
	tx.objectStore(STORE).put(song);
	await txDone(tx);
	localStorage.setItem(LAST_OPENED_KEY, song.id);
}

/** Cheap key-only existence check — never deserializes song payloads. */
export async function hasSong(id: string): Promise<boolean> {
	const db = await openDb();
	return (await request(db.transaction(STORE).objectStore(STORE).count(id))) > 0;
}

export async function deleteSong(id: string): Promise<void> {
	const db = await openDb();
	const tx = db.transaction(STORE, "readwrite");
	tx.objectStore(STORE).delete(id);
	await txDone(tx);
	const order = readOrder();
	if (order.includes(id)) writeOrder(order.filter((x) => x !== id));
	if (localStorage.getItem(LAST_OPENED_KEY) === id) {
		localStorage.removeItem(LAST_OPENED_KEY);
	}
}

// Manual library order: ids in ORDER_KEY come first in that order; songs the
// user has never moved trail behind them, newest first.
function readOrder(): string[] {
	try {
		const raw = localStorage.getItem(ORDER_KEY);
		return raw ? (JSON.parse(raw) as string[]) : [];
	} catch {
		return [];
	}
}

function writeOrder(order: string[]): void {
	localStorage.setItem(ORDER_KEY, JSON.stringify(order));
}

export async function listSongs(): Promise<Song[]> {
	const pos = new Map(readOrder().map((id, i) => [id, i]));
	return (await readAll()).sort((a, b) => {
		const pa = pos.get(a.id);
		const pb = pos.get(b.id);
		if (pa != null && pb != null) return pa - pb;
		if (pa != null) return -1;
		if (pb != null) return 1;
		return b.updatedAt - a.updatedAt;
	});
}

// Swap a song with its neighbor in the current visual order and pin the
// whole snapshot as the manual order from then on.
export async function moveSong(id: string, dir: -1 | 1): Promise<void> {
	const ids = (await listSongs()).map((s) => s.id);
	const i = ids.indexOf(id);
	const j = i + dir;
	if (i === -1 || j < 0 || j >= ids.length) return;
	[ids[i], ids[j]] = [ids[j], ids[i]];
	writeOrder(ids);
}

// Section.linkTo is a live, reducer-driven feature. Two older repeat shapes
// are folded into today's progression on load: the global per-section
// `repeat`, and the per-track `loops` unit (whose bars were already written
// out, so only the bookkeeping field is dropped).
interface LegacySection extends Section {
	/** global per-section repeat, replayed for every track */
	repeat?: number;
}

interface LegacyTrackLoops extends Track {
	/** sectionId → bars the track looped inside that section; bars were materialized */
	loops?: Record<number, number>;
}

// Short-lived historical track-audio shapes, kept loadable forever:
// `stem` (per-track timeline audio) had the exact semantics of today's
// `backing` and is carried over; `sample`/`instrument` were synth-voice
// experiments with no current equivalent and are stripped.
interface LegacyTrack extends Track {
	stem?: { name: string; mime: string; data: string };
	sample?: unknown;
	instrument?: unknown;
}

function migrateLegacyTrackAudio(song: Song): Song {
	const legacyTracks = song.tracks as LegacyTrack[];
	if (!legacyTracks.some((track) => track.stem || track.sample || track.instrument)) return song;
	return {
		...song,
		tracks: legacyTracks.map((track) => {
			const { stem, sample: _sample, instrument: _instrument, ...rest } = track;
			if (stem?.data && stem.mime && !rest.backing) rest.backing = { name: stem.name ?? "audio", mime: stem.mime, data: stem.data };
			return rest;
		}),
	};
}

// Both legacy repeat shapes collapse into the progression, which is exactly
// what they were trying to express: the global per-section `repeat` becomes
// that section's play count, and the per-track `loops` field is dropped (its
// repeated bars were already written out as real content, so nothing is lost).
function migrateLegacyRepeat(song: Song): Song {
	const legacySections = song.sections as LegacySection[];
	const legacyTracks = song.tracks as LegacyTrackLoops[];
	const hasRepeat = legacySections.some((s) => (s.repeat ?? 1) > 1);
	const hasLoops = legacyTracks.some((t) => t.loops);
	if (!hasRepeat && !hasLoops) return song;
	const sections = legacySections.map(({ repeat: _repeat, ...rest }) => rest);
	const tracks = legacyTracks.map(({ loops: _loops, ...rest }) => rest);
	const repeatOf = new Map(legacySections.map((s) => [s.id, Math.max(1, Math.floor(s.repeat ?? 1))]));
	const progression: ProgressionEntry[] | undefined = song.progression
		? song.progression
		: hasRepeat
			? [...sections]
					.sort((a, b) => a.startMeasure - b.startMeasure)
					.map((section) => ({ id: nextId(), sectionId: section.id, repeat: repeatOf.get(section.id) ?? 1 }))
			: undefined;
	return { ...song, sections, tracks, progression };
}

// linkTo is a live field the reducer keeps in sync as the user edits — this
// just self-heals it on load in case saved data ever drifted (nothing is
// stripped), and materializes the progression so every loaded song has one.
function resyncLiveFeatures(song: Song): Song {
	const ranges = sectionRangesFor(song.sections, song.measureCount);
	const tracks: Track[] = song.tracks.map((t) => ({
		...t,
		measures: t.measures.map((measure) => measure.map((col) => col.slice())),
		strums: t.strums?.map((row) => row.map(normalizeStrum)),
	}));
	ranges.forEach((r) => {
		if (r.linkTo == null) return;
		const src = ranges.find((x) => x.id === r.linkTo);
		if (!src) return;
		const span = r.endMeasure - r.startMeasure + 1;
		if (span !== src.endMeasure - src.startMeasure + 1) return;
		tracks.forEach((t) => {
			for (let off = 0; off < span; off++) {
				const from = t.measures[src.startMeasure + off];
				t.measures[r.startMeasure + off] = from ? from.map((col) => col.slice()) : makeMeasure(t.tuning.length);
				if (t.strums) {
					while (t.strums.length <= r.startMeasure + off) t.strums.push(blankStrumRow());
					t.strums[r.startMeasure + off] = (t.strums[src.startMeasure + off] ?? blankStrumRow()).slice();
				}
			}
		});
	});
	return { ...song, tracks, progression: normalizeProgression(song.progression, song.sections) };
}

// Entry ids come from the shared id counter, so it is advanced past every id
// the stored song already uses before any new one is minted.
export function migrateSong(song: Song): Song {
	advanceIdCounter(
		Math.max(
			0,
			...song.sections.map((section) => section.id),
			...song.tracks.map((track) => track.id),
			...(song.stems ?? []).map((stem) => stem.id),
			...(song.progression ?? []).map((entry) => entry.id),
		),
	);
	return resyncLiveFeatures(migrateLegacyRepeat(migrateLegacyTrackAudio(song)));
}

export async function loadSong(id: string): Promise<Song | null> {
	const song = await readOne(id);
	return song ? migrateSong(song) : null;
}

// Exports are minified JSON compressed with LZW (see lib/lzw.ts).
export async function exportLibrary(): Promise<Uint8Array> {
	const songs = await readAll();
	return compressText(JSON.stringify(Object.fromEntries(songs.map((s) => [s.id, s]))));
}

export async function exportSong(id: string): Promise<Uint8Array | null> {
	const song = await readOne(id);
	return song ? compressText(JSON.stringify(song)) : null;
}

function isSong(v: unknown): v is Song {
	const s = v as Song;
	return (
		!!s &&
		typeof s === "object" &&
		typeof s.id === "string" &&
		typeof s.title === "string" &&
		typeof s.measureCount === "number" &&
		Array.isArray(s.tracks) &&
		Array.isArray(s.sections)
	);
}

// Accepts a full library export, an array of songs, or a single song.
// Parsing is split from writing so the caller can prompt before overwriting
// songs whose ids already exist in the library.
// An import file is either an LZW-compressed export or plain JSON from an
// older export — both decode to the same shapes.
export function parseSongsFile(bytes: Uint8Array): Song[] {
	const json = isCompressedExport(bytes) ? decompressText(bytes) : new TextDecoder().decode(bytes);
	return parseSongsJson(json);
}

export function parseSongsJson(json: string): Song[] {
	const parsed: unknown = JSON.parse(json);
	const songs = isSong(parsed)
		? [parsed]
		: (Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? Object.values(parsed) : []).filter(
				isSong,
			);
	if (songs.length === 0) throw new Error("no songs in file");
	// Normalize legacy shapes right at the border so imported songs are stored
	// in today's format, not migrated over and over on every load.
	return songs.map(migrateSong);
}

// Merges by song id (imported wins).
export async function importSongs(songs: Song[]): Promise<void> {
	if (songs.length === 0) return;
	const db = await openDb();
	const tx = db.transaction(STORE, "readwrite");
	songs.forEach((s) => tx.objectStore(STORE).put(s));
	await txDone(tx);
}

export function getLastOpenedId(): string | null {
	return localStorage.getItem(LAST_OPENED_KEY);
}

export function setLastOpenedId(id: string): void {
	localStorage.setItem(LAST_OPENED_KEY, id);
}
