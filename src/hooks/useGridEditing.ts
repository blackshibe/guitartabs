import { useEffect, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import type { CellPos, RangeSelection, Track } from "../types";
import { COLS_PER_MEASURE } from "../lib/instruments";
import { globalCol, normalizeRect } from "../lib/clipboard";
import { toggleHarmonic } from "../lib/harmonics";
import type { SongAction } from "../lib/songReducer";

interface UseGridEditingArguments {
	activeTrack: Track | undefined;
	measureCount: number;
	selection: RangeSelection | null;
	setSelection: Dispatch<SetStateAction<RangeSelection | null>>;
	dispatch: Dispatch<SongAction | { type: "undo" } | { type: "redo" }>;
	isPlaying: boolean;
	startPlayback: (fromStep?: number) => void;
	stopPlayback: () => void;
	copySelection: () => void;
	cutSelection: () => void;
	pasteAtSelection: () => Promise<void>;
}

// Keyboard-first grid editing: digit entry, navigation, clipboard shortcuts,
// space-to-play — plus the window-level undo/redo listener.
export function useGridEditing({
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
}: UseGridEditingArguments) {
	// Undo/redo work everywhere except while typing in a text field.
	useEffect(() => {
		const onKey = (event: globalThis.KeyboardEvent) => {
			const target = event.target as HTMLElement;
			if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
			if (!(event.ctrlKey || event.metaKey)) return;
			const key = event.key.toLowerCase();
			if (key === "z") {
				event.preventDefault();
				dispatch({ type: event.shiftKey ? "redo" : "undo" });
			} else if (key === "y") {
				event.preventDefault();
				dispatch({ type: "redo" });
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [dispatch]);

	const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		// Don't hijack typing in text fields (section names, comments, measure notes).
		const target = event.target as HTMLElement;
		if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

		if (event.key === " ") {
			event.preventDefault();
			if (isPlaying) stopPlayback();
			else startPlayback(selection ? globalCol(selection.focus.measure, selection.focus.column) : 0);
			return;
		}

		const withModifier = event.ctrlKey || event.metaKey;
		if (withModifier) {
			const key = event.key.toLowerCase();
			if (key === "c") {
				event.preventDefault();
				copySelection();
				return;
			}
			if (key === "x") {
				event.preventDefault();
				cutSelection();
				return;
			}
			if (key === "v") {
				event.preventDefault();
				void pasteAtSelection();
				return;
			}
		}

		if (!selection || !activeTrack) return;
		const { focus } = selection;

		const setFocus = (measure: number, column: number, stringIndex: number, extend: boolean) => {
			event.preventDefault();
			const position: CellPos = { measure, column, stringIndex };
			setSelection((previous) =>
				extend && previous ? { anchor: previous.anchor, focus: position } : { anchor: position, focus: position },
			);
		};

		if (event.key >= "0" && event.key <= "9") {
			event.preventDefault();
			const current = activeTrack.measures[focus.measure][focus.column][focus.stringIndex];
			let nextValue = current === null || current === "" ? event.key : String(Number(current + event.key));
			if (nextValue.length > 2 || Number(nextValue) > 24) nextValue = event.key;
			dispatch({
				type: "set-cell",
				trackId: activeTrack.id,
				measure: focus.measure,
				column: focus.column,
				stringIndex: focus.stringIndex,
				value: nextValue,
			});
			setSelection({ anchor: focus, focus });
			return;
		}

		if (event.key === "h" || event.key === "H") {
			event.preventDefault();
			const current = activeTrack.measures[focus.measure][focus.column][focus.stringIndex];
			if (current !== null && current !== "") {
				dispatch({
					type: "set-cell",
					trackId: activeTrack.id,
					measure: focus.measure,
					column: focus.column,
					stringIndex: focus.stringIndex,
					value: toggleHarmonic(current),
				});
			}
			return;
		}

		if (event.key === "Backspace" || event.key === "Delete") {
			event.preventDefault();
			dispatch({ type: "clear-range", trackId: activeTrack.id, rect: normalizeRect(selection) });
			return;
		}
		if (event.key === "ArrowUp") {
			if (focus.stringIndex > 0) setFocus(focus.measure, focus.column, focus.stringIndex - 1, event.shiftKey);
			else event.preventDefault();
			return;
		}
		if (event.key === "ArrowDown") {
			if (focus.stringIndex < activeTrack.tuning.length - 1)
				setFocus(focus.measure, focus.column, focus.stringIndex + 1, event.shiftKey);
			else event.preventDefault();
			return;
		}
		if (event.key === "ArrowLeft" || (event.key === "Tab" && event.shiftKey)) {
			event.preventDefault();
			if (focus.column > 0) setFocus(focus.measure, focus.column - 1, focus.stringIndex, event.shiftKey);
			else if (focus.measure > 0)
				setFocus(focus.measure - 1, COLS_PER_MEASURE - 1, focus.stringIndex, event.shiftKey);
			return;
		}
		if (event.key === "ArrowRight" || event.key === "Tab") {
			event.preventDefault();
			if (focus.column < COLS_PER_MEASURE - 1)
				setFocus(focus.measure, focus.column + 1, focus.stringIndex, event.shiftKey);
			else if (focus.measure < measureCount - 1) setFocus(focus.measure + 1, 0, focus.stringIndex, event.shiftKey);
			else {
				// At the very end the grid grows under the cursor.
				dispatch({ type: "insert-measure", after: measureCount - 1 });
				setFocus(measureCount, 0, focus.stringIndex, false);
			}
			return;
		}
		if (event.key === "Escape") setSelection(null);
	};

	return { handleGridKeyDown };
}
