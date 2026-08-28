import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { COLS_PER_MEASURE, advanceIdCounter, defaultTuning, makeTrack, nextId } from "./lib/instruments";
import { decodeAudio, setStemVolume } from "./lib/audio";
import { sectionRangesFor } from "./lib/songOps";
import { buildExportText } from "./lib/exportText";
import { globalCol } from "./lib/clipboard";
import { historyReducer, initHistory } from "./lib/songReducer";
import type { Song } from "./types";
import { useToast } from "./hooks/useToast";
import { usePlayback } from "./hooks/usePlayback";
import { useSelection } from "./hooks/useSelection";
import { useClipboard } from "./hooks/useClipboard";
import { useGridEditing } from "./hooks/useGridEditing";
import { useSongLibrary } from "./hooks/useSongLibrary";
import TrackTabs from "./components/TrackTabs";
import SectionNav from "./components/SectionNav";
import TabGrid from "./components/TabGrid";
import TuningEditor from "./components/TuningEditor";
import SongSidebar from "./components/SongSidebar";
import ExportPanel from "./components/ExportPanel";
import YoutubeSyncPanel, { type YoutubeSyncHandle } from "./components/YoutubeSync";
import TransportBar from "./components/TransportBar";
import Toast from "./components/Toast";
import ImportConflictDialog from "./components/ImportConflictDialog";
import WelcomeDialog from "./components/WelcomeDialog";
import GhostScreen from "./components/GhostScreen";

function blankSong(): Song {
	const track = makeTrack("Guitar", defaultTuning(), 4);
	return {
		id: crypto.randomUUID(),
		title: "Untitled Song",
		bpm: 100,
		measureCount: 4,
		sections: [{ id: nextId(), name: "Intro", startMeasure: 0, comment: "" }],
		tracks: [track],
		updatedAt: Date.now(),
	};
}

// Composition root: the song reducer plus one hook per concern (toast,
// playback, selection, clipboard, grid keys, library). Song content changes
// go through dispatch; the hooks own their own state and effects.
export default function App() {
	const [initialSong] = useState<Song>(() => blankSong());
	const [history, dispatch] = useReducer(historyReducer, initialSong, initHistory);
	const song = history.present;
	const { title, bpm, measureCount, sections, tracks, youtube, stems } = song;

	const [activeTrackId, setActiveTrackId] = useState<number>(initialSong.tracks[0]?.id);
	const [tuningEditorTrackId, setTuningEditorTrackId] = useState<number | null>(null);
	const [showWelcome, setShowWelcome] = useState<boolean>(() => localStorage.getItem("tab-editor:welcomed") == null);
	const sectionRefs = useRef<Record<number, HTMLDivElement | null>>({});
	const youtubePlayerRef = useRef<YoutubeSyncHandle | null>(null);

	const activeTrack = tracks.find((track) => track.id === activeTrackId) ?? tracks[0];
	const sectionRanges = useMemo(() => sectionRangesFor(sections, measureCount), [sections, measureCount]);

	const { toastMessage, showToast } = useToast();
	const { isPlaying, playhead, startPlayback, stopPlayback } = usePlayback(song, youtubePlayerRef);
	const { selection, setSelection, gridRef, handleCellMouseDown, handleCellEnter } = useSelection(
		activeTrack,
		measureCount,
	);
	const { canPasteSection, copySelection, cutSelection, pasteAtSelection, copySection, pasteSectionAt } =
		useClipboard({ song, sectionRanges, activeTrack, selection, dispatch, showToast });
	const { handleGridKeyDown } = useGridEditing({
		activeTrack,
		measureCount,
		selection,
		setSelection,
		dispatch,
		isPlaying,
		startPlayback,
		stopPlayback,
		copySelection,
		cutSelection,
		pasteAtSelection,
	});

	const applySong = (nextSong: Song) => {
		stopPlayback();
		const maxId = Math.max(
			0,
			...nextSong.sections.map((section) => section.id),
			...nextSong.tracks.map((track) => track.id),
			...(nextSong.stems ?? []).map((stem) => stem.id),
		);
		advanceIdCounter(maxId);
		dispatch({ type: "load-song", song: nextSong });
		setActiveTrackId(nextSong.tracks[0]?.id);
		setSelection(null);
		setTuningEditorTrackId(null);
	};

	const library = useSongLibrary({ song, applySong, showToast });

	useEffect(() => {
		const maxId = Math.max(
			0,
			...initialSong.sections.map((section) => section.id),
			...initialSong.tracks.map((track) => track.id),
		);
		advanceIdCounter(maxId);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Pre-warm audio decodes so the first play after a reload starts on time.
	useEffect(() => {
		tracks.forEach((track) => {
			if (track.backing) decodeAudio(track.backing).catch(() => {});
		});
		(stems ?? []).forEach((stem) => decodeAudio(stem).catch(() => {}));
	}, [tracks, stems]);

	// ---- measures & sections ----
	const deleteMeasure = (measure: number) => {
		if (measureCount <= 1) {
			showToast("Can't delete the last measure");
			return;
		}
		dispatch({ type: "delete-measure", measure });
	};

	const addSectionHere = () => {
		const measure = selection ? selection.focus.measure : measureCount - 1;
		if (sections.some((section) => section.startMeasure === measure)) {
			showToast("A section already starts here");
			return;
		}
		dispatch({ type: "add-section-at", measure });
	};

	const jumpToSection = (sectionId: number) => {
		sectionRefs.current[sectionId]?.scrollIntoView({ behavior: "smooth", block: "start" });
	};

	// ---- tracks ----
	const addTrack = () => {
		const track = makeTrack(`Track ${tracks.length + 1}`, defaultTuning(), measureCount);
		dispatch({ type: "add-track", track });
		setActiveTrackId(track.id);
	};

	const removeTrack = (trackId: number) => {
		if (tracks.length <= 1) return;
		dispatch({ type: "remove-track", id: trackId });
		if (activeTrackId === trackId) setActiveTrackId(tracks.filter((track) => track.id !== trackId)[0]?.id);
		if (tuningEditorTrackId === trackId) setTuningEditorTrackId(null);
		showToast("Track removed, Ctrl+Z to undo");
	};

	const setTrackVolume = (trackId: number, volume: number) => {
		dispatch({ type: "set-track-volume", id: trackId, volume });
		setStemVolume(trackId, volume); // retarget a playing backing (keyed by track id)
	};

	// ---- uploaded audio (track backings and song stems) ----

	// Read an uploaded mp3/ogg into a base64 payload, decode-validated before
	// the caller commits it. Returns null (after toasting) on any failure.
	const readAudioFile = async (file: File): Promise<{ name: string; mime: string; data: string } | null> => {
		const mime = file.type || (file.name.toLowerCase().endsWith(".ogg") ? "audio/ogg" : "audio/mpeg");
		if (!/audio\/(ogg|mpeg|mp3)/.test(mime)) {
			showToast("Only .ogg or .mp3");
			return null;
		}
		const data = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve((reader.result as string).split(",")[1]);
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(file);
		}).catch(() => null);
		if (!data) {
			showToast("Import failed");
			return null;
		}
		const payload = { name: file.name, mime, data };
		try {
			await decodeAudio(payload);
		} catch {
			showToast("Couldn't decode audio");
			return null;
		}
		return payload;
	};

	const setTrackBacking = async (trackId: number, file: File | null) => {
		if (!file) {
			dispatch({ type: "set-track-backing", id: trackId, backing: null });
			return;
		}
		const payload = await readAudioFile(file);
		if (!payload) return;
		dispatch({ type: "set-track-backing", id: trackId, backing: payload });
		showToast("Backing attached");
	};

	const addStem = async (file: File) => {
		const payload = await readAudioFile(file);
		if (!payload) return;
		dispatch({ type: "add-stem", stem: { id: nextId(), ...payload } });
		showToast("Stem added");
	};

	const removeStem = (stemId: number) => dispatch({ type: "remove-stem", id: stemId });

	const setSongStemVolume = (stemId: number, volume: number) => {
		dispatch({ type: "set-stem-volume", id: stemId, volume });
		setStemVolume(stemId, volume); // retarget a stem already playing
	};

	// ---- derived view state ----
	const exportText = useMemo(() => buildExportText({ ...song, updatedAt: 0 }), [song]);

	const activeSectionId = useMemo(() => {
		const measure = playhead?.measure ?? selection?.focus.measure;
		if (measure == null) return null;
		return sectionRanges.find((range) => measure >= range.startMeasure && measure <= range.endMeasure)?.id ?? null;
	}, [playhead, selection, sectionRanges]);

	const totalSteps = measureCount * COLS_PER_MEASURE;
	const playProgress = playhead ? globalCol(playhead.measure, playhead.column) / Math.max(1, totalSteps - 1) : null;
	const measureNotes = song.measureNotes ?? [];

	if (!library.hydrated) return <GhostScreen />;

	return (
		<div className="flex flex-col md:flex-row items-start">
			<SongSidebar
				songs={library.librarySongs}
				currentSongId={song.id}
				isAutosaved={library.isAutosaved}
				onLoad={library.loadSong}
				onDelete={library.deleteSong}
				onMove={library.moveSong}
				onNew={() => applySong(blankSong())}
				onSave={library.saveCurrentSong}
				onExport={library.exportLibrary}
				onExportSong={library.exportSong}
				onImport={library.importFromFile}
			/>

			<div className="min-w-0 flex-1 max-w-[1100px] mx-auto px-5 pt-6 pb-24">
				<input
					className="block w-full bg-transparent border-none outline-none font-display font-semibold text-[2.25rem] leading-tight tracking-tight text-ink py-1 mb-3 placeholder-ink-faint"
					value={title}
					onChange={(event) => dispatch({ type: "set-title", title: event.target.value })}
					placeholder="Untitled Song"
				/>

				{/* Pinned so the track switcher and section jump stay reachable
            while scrolling a long tab — only the score body scrolls
            underneath. Add-measure/add-section live in the bottom transport
            bar alongside playback, so every editing action stays in one
            fixed place regardless of scroll position. */}
				<div
					data-keep-selection
					className="sticky top-0 z-20 bg-plate pt-1 pb-3 -mx-5 px-5 border-b border-hairline-strong"
				>
					<TrackTabs
						tracks={tracks}
						activeTrackId={activeTrackId}
						onSelect={setActiveTrackId}
						onRename={(trackId, name) => dispatch({ type: "rename-track", id: trackId, name })}
						onEditTuning={setTuningEditorTrackId}
						onRemove={removeTrack}
						onAdd={addTrack}
					/>

					<SectionNav
						sectionRanges={sectionRanges}
						activeSectionId={activeSectionId}
						canPaste={canPasteSection}
						onJump={jumpToSection}
						onAddAt={(measure) => dispatch({ type: "add-section-after", measure })}
						onPasteAt={pasteSectionAt}
						onLink={(sectionId, to) => dispatch({ type: "link-section", id: sectionId, to })}
						onUnlink={(sectionId) => dispatch({ type: "unlink-section", id: sectionId })}
					/>
				</div>

				{activeTrack && (
					<TabGrid
						className="mt-4"
						track={activeTrack}
						sectionRanges={sectionRanges}
						measureCount={measureCount}
						measureNotes={measureNotes}
						canDeleteSection={sections.length > 1}
						stepDurationMs={(60 / bpm / 2) * 1000}
						selected={selection}
						playhead={playhead}
						gridRef={gridRef}
						onCellMouseDown={(measure, column, stringIndex, shiftKey) => {
							handleCellMouseDown(measure, column, stringIndex, shiftKey);
							// Clicking a cell mid-playback jumps playback there.
							if (isPlaying && !shiftKey) startPlayback(globalCol(measure, column));
						}}
						onCellEnter={handleCellEnter}
						onDeleteMeasure={deleteMeasure}
						onInsertMeasureAfter={(measure) => dispatch({ type: "insert-measure", after: measure })}
						onRenameSection={(sectionId, name) => dispatch({ type: "rename-section", id: sectionId, name })}
						onCommentChange={(sectionId, text) =>
							dispatch({ type: "set-section-comment", id: sectionId, text })
						}
						onTrackCommentChange={(sectionId, text) =>
							dispatch({ type: "set-section-comment", id: sectionId, trackId: activeTrack.id, text })
						}
						onCopySection={copySection}
						onDeleteSection={(sectionId) => dispatch({ type: "delete-section", id: sectionId })}
						onSetTrackLoop={(sectionId, unit) =>
							dispatch({ type: "set-track-loop", trackId: activeTrack.id, sectionId, unit })
						}
						onSetMeasureNote={(measure, text) => dispatch({ type: "set-measure-note", measure, text })}
						onKeyDown={handleGridKeyDown}
						registerSectionRef={(sectionId, element) => {
							sectionRefs.current[sectionId] = element;
						}}
					/>
				)}

				{tuningEditorTrackId !== null && (
					<TuningEditor
						trackName={tracks.find((track) => track.id === tuningEditorTrackId)?.name ?? ""}
						tuning={tracks.find((track) => track.id === tuningEditorTrackId)?.tuning ?? []}
						onChange={(nextTuning) =>
							dispatch({ type: "set-track-tuning", id: tuningEditorTrackId, tuning: nextTuning })
						}
						onClose={() => setTuningEditorTrackId(null)}
					/>
				)}

				<ExportPanel text={exportText} />
			</div>

			<YoutubeSyncPanel
				ref={youtubePlayerRef}
				youtube={youtube}
				anchorMeasure={selection?.focus.measure ?? playhead?.measure ?? 0}
				tracks={tracks}
				stems={stems ?? []}
				onSetVideo={(videoId) => dispatch({ type: "set-youtube-video", videoId })}
				onSetAnchor={(measure, seconds) => dispatch({ type: "set-youtube-anchor", measure, seconds })}
				onSetTrackVolume={setTrackVolume}
				onSetTrackBacking={setTrackBacking}
				onAddStem={addStem}
				onRemoveStem={removeStem}
				onSetStemVolume={setSongStemVolume}
			/>

			<TransportBar
				bpm={bpm}
				onBpmChange={(nextBpm) => dispatch({ type: "set-bpm", bpm: nextBpm })}
				isPlaying={isPlaying}
				hasSelection={selection !== null}
				progress={playProgress}
				onPlay={() => startPlayback(selection ? globalCol(selection.focus.measure, selection.focus.column) : 0)}
				onPlayFromStart={() => startPlayback(0)}
				onStop={stopPlayback}
				onSeek={(fraction) => startPlayback(Math.round(fraction * (totalSteps - 1)))}
				onAddMeasure={() => dispatch({ type: "insert-measure", after: measureCount - 1 })}
				onAddSection={addSectionHere}
			/>

			<Toast message={toastMessage} />
			{library.importConflicts && (
				<ImportConflictDialog
					conflicts={library.importConflicts.conflicts}
					existing={library.librarySongs}
					onConfirm={library.resolveImportConflicts}
				/>
			)}
			{showWelcome && (
				<WelcomeDialog
					onDismiss={() => {
						localStorage.setItem("tab-editor:welcomed", "1");
						setShowWelcome(false);
					}}
				/>
			)}
		</div>
	);
}
