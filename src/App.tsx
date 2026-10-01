import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { PdfOptions } from "./lib/pdf";
import { COLS_PER_MEASURE, advanceIdCounter, defaultTuning, makeTrack, nextId } from "./lib/instruments";
import { decodeAudio, setStemVolume } from "./lib/audio";
import { sectionRangesFor } from "./lib/songOps";
import { buildExportText } from "./lib/exportText";
import { downloadFile } from "./lib/download";
import { buildSlots, playableSteps, shownSlotIndex, slotForMeasure, stepOf } from "./lib/progression";
import { historyReducer, initHistory } from "./lib/songReducer";
import type { Song } from "./types";
import { useToast } from "./hooks/useToast";
import { usePlayback } from "./hooks/usePlayback";
import { useSelection } from "./hooks/useSelection";
import { useClipboard } from "./hooks/useClipboard";
import { useGridEditing } from "./hooks/useGridEditing";
import { useSongLibrary } from "./hooks/useSongLibrary";
import TrackTabs from "./components/TrackTabs";
import ProgressionStrip from "./components/ProgressionStrip";
import TabGrid, { type LyricEdit } from "./components/TabGrid";
import ProgressionView from "./components/ProgressionView";
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
//
// The progression — expanded here into `slots`, one per played copy of a
// section — is what the grid renders and what playback walks, so both take
// slots rather than raw section ranges.
export default function App() {
	const [initialSong] = useState<Song>(() => blankSong());
	const [history, dispatch] = useReducer(historyReducer, initialSong, initHistory);
	const song = history.present;
	const { title, bpm, measureCount, sections, progression, tracks, youtube, stems } = song;

	const [activeTrackId, setActiveTrackId] = useState<number>(initialSong.tracks[0]?.id);
	const [tuningEditorTrackId, setTuningEditorTrackId] = useState<number | null>(null);
	const [view, setView] = useState<"tab" | "progression">("tab");
	const [lyricEdit, setLyricEdit] = useState<LyricEdit | null>(null);
	// Draw every pass of a repeat as its own block instead of one block ×N.
	const [expandRepeats, setExpandRepeats] = useState<boolean>(() => {
		try {
			return localStorage.getItem("tab-editor:expand-repeats") === "1";
		} catch {
			return false;
		}
	});
	const toggleExpandRepeats = () => {
		setExpandRepeats((current) => {
			try {
				localStorage.setItem("tab-editor:expand-repeats", current ? "0" : "1");
			} catch {
				// remembered only when storage allows
			}
			return !current;
		});
		setLyricEdit(null);
	};
	const [showWelcome, setShowWelcome] = useState<boolean>(() => localStorage.getItem("tab-editor:welcomed") == null);
	const youtubePlayerRef = useRef<YoutubeSyncHandle | null>(null);

	const activeTrack = tracks.find((track) => track.id === activeTrackId) ?? tracks[0];
	const sectionRanges = useMemo(() => sectionRangesFor(sections, measureCount), [sections, measureCount]);
	const slots = useMemo(() => buildSlots(sectionRanges, progression), [sectionRanges, progression]);
	// The grid draws each repeated section once — its first pass; later passes
	// are the same bars.
	const shownSlots = useMemo(
		() => (expandRepeats ? slots : slots.filter((slot) => slot.repeatIndex === 0)),
		[slots, expandRepeats],
	);
	const shownIndex = (index: number) => (expandRepeats ? index : shownSlotIndex(slots, index));

	const { toastMessage, showToast } = useToast();
	const { isPlaying, playhead, startPlayback, stopPlayback } = usePlayback(song, slots, youtubePlayerRef);
	const { selection, setSelection, activeSlot, setActiveSlot, gridRef, handleCellMouseDown, handleCellEnter } =
		useSelection(activeTrack, measureCount, slots);
	const { canPasteSection, copySelection, cutSelection, pasteAtSelection, copySection, pasteSectionAt } =
		useClipboard({ song, sectionRanges, activeTrack, selection, dispatch, showToast });
	const { handleGridKeyDown } = useGridEditing({
		activeTrack,
		slots,
		expanded: expandRepeats,
		activeSlot,
		setActiveSlot,
		selection,
		setSelection,
		dispatch,
		isPlaying,
		startPlayback,
		stopPlayback,
		copySelection,
		cutSelection,
		pasteAtSelection,
		editLyric: (measure, column) =>
			setLyricEdit({
				slot: shownIndex(activeSlot),
				pass: slots[activeSlot]?.repeatIndex ?? 0,
				measure,
				column,
			}),
	});

	const applySong = (nextSong: Song) => {
		stopPlayback();
		const maxId = Math.max(
			0,
			...nextSong.sections.map((section) => section.id),
			...nextSong.tracks.map((track) => track.id),
			...(nextSong.stems ?? []).map((stem) => stem.id),
			...(nextSong.progression ?? []).map((entry) => entry.id),
		);
		advanceIdCounter(maxId);
		dispatch({ type: "load-song", song: nextSong });
		setActiveTrackId(nextSong.tracks[0]?.id);
		setSelection(null);
		setActiveSlot(0);
		setTuningEditorTrackId(null);
		setLyricEdit(null);
	};

	const library = useSongLibrary({
		song,
		applySong,
		replaceLyrics: (lyrics) => dispatch({ type: "replace-lyrics", lyrics }),
		showToast,
	});


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

	const deleteSection = (sectionId: number) => {
		const section = sectionRanges.find((range) => range.id === sectionId);
		if (!section) return;
		const span = section.endMeasure - section.startMeasure + 1;
		if (sections.length <= 1 || measureCount - span < 1) {
			showToast("Can't delete the last section");
			return;
		}
		const bars = `${span} bar${span === 1 ? "" : "s"}`;
		if (window.confirm(`Delete "${section.name}" and its ${bars}?`)) {
			dispatch({ type: "delete-section", id: sectionId });
		}
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
		showToast("Track removed");
	};

	const setTrackVolume = (trackId: number, volume: number) => {
		dispatch({ type: "set-track-volume", id: trackId, volume });
		setStemVolume(trackId, volume); // retarget a playing backing (keyed by track id)
	};

	// ---- uploaded audio (track backings and song stems) ----

	// Read an uploaded mp3/ogg into a base64 payload, decode-validated before
	// the caller commits it. Returns null (after toasting) on any failure.
	const readAudioFile = async (file: File): Promise<{ name: string; mime: string; data: string } | null> => {
		// The OS often reports .ogg as video/ogg or application/ogg (or nothing),
		// so the extension decides; decodeAudio below validates the real content.
		const name = file.name.toLowerCase();
		const mime = name.endsWith(".ogg") ? "audio/ogg" : name.endsWith(".mp3") ? "audio/mpeg" : file.type;
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
	const buildTracksText = (trackIds: number[]) =>
		buildExportText({ ...song, tracks: song.tracks.filter((track) => trackIds.includes(track.id)), updatedAt: 0 });

	const exportFileName = (suffix: string) => `${song.title}${suffix}`.replace(/[<>:"/\\|?*]/g, "-");

	const exportTracksText = (trackIds: number[]) => {
		downloadFile(buildTracksText(trackIds), `${exportFileName("")}.txt`, "text/plain");
	};

	const exportTracksPdf = async (trackIds: number[], options: PdfOptions) => {
		// Lazy import keeps jsPDF out of the main bundle until an export happens.
		const { buildTrackPdf } = await import("./lib/pdf");
		for (const trackId of trackIds) {
			const track = song.tracks.find((candidate) => candidate.id === trackId);
			if (!track) continue;
			downloadFile(buildTrackPdf(song, trackId, options), `${exportFileName(` - ${track.name}`)}.pdf`, "application/pdf");
		}
	};

	// Where the cursor sits on the expanded (arrangement) timeline — the unit
	// playback, seeking and the reference-video anchor all speak in.
	const currentStep = useMemo(() => {
		if (playhead) {
			// Editing the arrangement mid-playback can reshuffle slots under a
			// playhead captured against the old ones — only trust an index that
			// still names a slot over the measure being played.
			const slot = slots[playhead.slot];
			if (slot && playhead.measure >= slot.startMeasure && playhead.measure < slot.startMeasure + slot.span) {
				return stepOf(slot, playhead.measure, playhead.column);
			}
		}
		if (selection) {
			const slot = slotForMeasure(slots, selection.focus.measure, activeSlot);
			if (slot) return stepOf(slot, selection.focus.measure, selection.focus.column);
		}
		return 0;
	}, [playhead, selection, slots, activeSlot]);

	const currentSlot = playhead ? slots[playhead.slot] : selection ? slots[activeSlot] : undefined;
	// Every pass of a repeat plays on the one block the grid draws for it.
	const shownPlayhead = useMemo(
		() => (playhead ? { ...playhead, slot: expandRepeats ? playhead.slot : shownSlotIndex(slots, playhead.slot) } : null),
		[playhead, slots, expandRepeats],
	);
	const activeEntryId = playhead ? (slots[playhead.slot]?.entryId ?? null) : null;

	const totalSteps = playableSteps(slots);
	const playProgress = playhead ? currentStep / Math.max(1, totalSteps - 1) : null;
	const measureNotes = song.measureNotes ?? [];

	if (!library.hydrated) return <GhostScreen />;

	const viewTab = (key: "tab" | "progression", label: string) => (
		<button
			className={
				"text-xs px-3 py-1.5 border-b-2 transition-colors " +
				(view === key
					? "bg-plate-sunken border-b-accent text-ink"
					: "bg-plate-raised border-b-hairline-strong text-ink-soft hover:text-ink")
			}
			onClick={() => setView(key)}
		>
			{label}
		</button>
	);

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

				{/* Pinned so the track switcher, the Tab/Progression switch and the
            section jump stay reachable while scrolling a long tab — only the
            score body scrolls underneath. Add-measure/add-section live in the
            bottom transport bar alongside playback, so every editing action
            stays in one fixed place regardless of scroll position. */}
				<div
					data-keep-selection
					className="sticky top-0 z-20 bg-plate pt-1 pb-3 -mx-5 px-5 border-b border-hairline-strong"
				>
					<div className="flex items-start gap-4">
						<div className="min-w-0 flex-1">
							<TrackTabs
								tracks={tracks}
								activeTrackId={activeTrackId}
								onSelect={setActiveTrackId}
								onRename={(trackId, name) => dispatch({ type: "rename-track", id: trackId, name })}
								onEditTuning={setTuningEditorTrackId}
								onRemove={removeTrack}
								onAdd={addTrack}
							/>
						</div>
						<div className="flex shrink-0 items-center gap-1 pt-1">
							{viewTab("tab", "Tab")}
							{viewTab("progression", "Progression")}
							{view === "tab" && (
								<button
									className={
										"ml-2 text-xs px-3 py-1.5 border-b-2 transition-colors " +
										(expandRepeats
											? "bg-plate-sunken border-b-accent text-ink"
											: "bg-plate-raised border-b-hairline-strong text-ink-soft hover:text-ink")
									}
									onClick={toggleExpandRepeats}
									title="Draw every pass of a repeat as its own block"
								>
									Expand repeats
								</button>
							)}
							<div className="ml-3 border-l border-hairline pl-3">
								<ExportPanel
									tracks={song.tracks.map((track) => ({ id: track.id, name: track.name }))}
									buildText={buildTracksText}
									onExportText={exportTracksText}
									onExportPdf={exportTracksPdf}
								/>
							</div>
						</div>
					</div>

					{view === "tab" && <ProgressionStrip slots={slots} activeSlot={currentSlot?.index ?? -1} />}
				</div>

				{view === "progression" ? (
					<ProgressionView
						progression={progression}
						sectionRanges={sectionRanges}
						slots={slots}
						activeEntryId={activeEntryId}
						onRename={(sectionId, name) => dispatch({ type: "rename-section", id: sectionId, name })}
						onSetRepeat={(entryId, repeat) => dispatch({ type: "set-entry-repeat", entryId, repeat })}
						onMove={(entryId, direction) => dispatch({ type: "move-entry", entryId, direction })}
						onRemove={(entryId) => dispatch({ type: "remove-entry", entryId })}
						onAdd={(sectionId) => dispatch({ type: "add-entry", sectionId })}
						onNewSection={() => dispatch({ type: "add-section-after", measure: measureCount })}
						leadInBars={song.leadInBars ?? 0}
						onSetLeadIn={(bars) => dispatch({ type: "set-lead-in", bars })}
						canPasteSection={canPasteSection}
						onPasteSection={() => pasteSectionAt(measureCount)}
					/>
				) : (
					activeTrack && (
						<TabGrid
							className="mt-4"
							track={activeTrack}
							slots={shownSlots}
							expanded={expandRepeats}
							activeSlot={shownIndex(activeSlot)}
							measureCount={measureCount}
							measureNotes={measureNotes}
							lyrics={song.lyrics}
							lyricEdit={lyricEdit}
							onEditLyric={setLyricEdit}
							onSetLyric={(entryId, pass, offset, column, text) =>
								dispatch({ type: "set-lyric", entryId, pass, offset, column, text })
							}
							canDeleteSection={sections.length > 1}
							stepDurationMs={(60 / (currentSlot?.section.bpm ?? bpm) / 2) * 1000}
							selected={selection}
							playhead={shownPlayhead}
							playheadPass={playhead ? (slots[playhead.slot]?.repeatIndex ?? 0) : 0}
							gridRef={gridRef}
							onCellMouseDown={(position, slotIndex, shiftKey) => {
								handleCellMouseDown(position, slotIndex, shiftKey);
								// Clicking a cell mid-playback jumps playback there — straight
								// in, never back through the lead-in.
								const slot = slots[slotIndex];
								if (isPlaying && !shiftKey && slot && !slot.unused) {
									startPlayback(stepOf(slot, position.measure, position.column), true);
								}
							}}
							onCellEnter={handleCellEnter}
							onDeleteMeasure={deleteMeasure}
							onInsertMeasureAfter={(measure) => dispatch({ type: "insert-measure", after: measure })}
							onRenameSection={(sectionId, name) => dispatch({ type: "rename-section", id: sectionId, name })}
							onSetSectionBpm={(sectionId, sectionBpm) =>
								dispatch({ type: "set-section-bpm", id: sectionId, bpm: sectionBpm })
							}
							songBpm={bpm}
							onTrackCommentChange={(sectionId, text) =>
								dispatch({ type: "set-section-comment", id: sectionId, trackId: activeTrack.id, text })
							}
							onCopySection={copySection}
							onDeleteSection={deleteSection}
							onAddToProgression={(sectionId) => dispatch({ type: "add-entry", sectionId })}
							onSetMeasureNote={(measure, text) => dispatch({ type: "set-measure-note", measure, text })}
							onKeyDown={handleGridKeyDown}
						/>
					)
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

			</div>

			<YoutubeSyncPanel
				ref={youtubePlayerRef}
				youtube={youtube}
				anchorMeasure={Math.floor(currentStep / COLS_PER_MEASURE)}
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
				onPlay={() => startPlayback(selection ? currentStep : 0, selection !== null)}
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
