import { useState, type Dispatch } from "react";
import type { RangeSelection, SectionRange, Song, Track } from "../types";
import { COLS_PER_MEASURE } from "../lib/instruments";
import { copyRange, normalizeRect, parsePayload, sectionToClipboard, type ClipboardPayload } from "../lib/clipboard";
import type { SongAction } from "../lib/songReducer";

interface UseClipboardArguments {
	song: Song;
	sectionRanges: SectionRange[];
	activeTrack: Track | undefined;
	selection: RangeSelection | null;
	dispatch: Dispatch<SongAction>;
	showToast: (message: string) => void;
}

// Cell-range and whole-section copy/cut/paste. The internal clipboard state
// is authoritative; the OS clipboard is a best-effort JSON mirror.
export function useClipboard({ song, sectionRanges, activeTrack, selection, dispatch, showToast }: UseClipboardArguments) {
	const [clipboard, setClipboard] = useState<ClipboardPayload | null>(null);

	const putOnClipboard = (payload: ClipboardPayload) => {
		setClipboard(payload);
		navigator.clipboard?.writeText(JSON.stringify(payload)).catch(() => {});
	};

	const copySelection = () => {
		if (!selection || !activeTrack) return;
		putOnClipboard(copyRange(activeTrack, normalizeRect(selection)));
		showToast("Copied");
	};

	const cutSelection = () => {
		if (!selection || !activeTrack) return;
		const rect = normalizeRect(selection);
		putOnClipboard(copyRange(activeTrack, rect));
		dispatch({ type: "clear-range", trackId: activeTrack.id, rect });
		showToast("Cut");
	};

	const pasteAtSelection = async () => {
		if (!selection || !activeTrack) return;
		let payload = clipboard;
		try {
			const parsed = parsePayload(await navigator.clipboard.readText());
			if (parsed) payload = parsed;
		} catch {
			// OS clipboard unavailable — the internal one still works
		}
		if (!payload) {
			showToast("Nothing to paste");
			return;
		}
		if (payload.kind === "tab-editor/cells") {
			const rect = normalizeRect(selection);
			const at = {
				measure: Math.floor(rect.startColumn / COLS_PER_MEASURE),
				column: rect.startColumn % COLS_PER_MEASURE,
				stringIndex: rect.startString,
			};
			dispatch({ type: "paste-cells", trackId: activeTrack.id, at, clip: payload });
		} else {
			const section = sectionRanges.find(
				(range) => selection.focus.measure >= range.startMeasure && selection.focus.measure <= range.endMeasure,
			);
			if (section) {
				dispatch({ type: "paste-section", at: section.endMeasure + 1, clip: payload });
				showToast("Section pasted");
			}
		}
	};

	const copySection = (sectionId: number) => {
		const section = sectionRanges.find((range) => range.id === sectionId);
		if (!section) return;
		putOnClipboard(sectionToClipboard(song.tracks, section, song.id, song.measureNotes));
		showToast("Section copied");
	};

	const pasteSectionAt = (measure: number) => {
		if (clipboard?.kind !== "tab-editor/section") return;
		dispatch({ type: "paste-section", at: measure, clip: clipboard });
	};

	return {
		canPasteSection: clipboard?.kind === "tab-editor/section",
		copySelection,
		cutSelection,
		pasteAtSelection,
		copySection,
		pasteSectionAt,
	};
}
