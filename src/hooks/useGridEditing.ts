import { useEffect, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import type { CellPos, RangeSelection, Track } from "../types";
import { normalizeRect } from "../lib/clipboard";
import { cycleRing, toggleHarmonic, typeDigit } from "../lib/cellValue";
import { locateStep, slotForMeasure, stepOf, type ProgressionSlot } from "../lib/progression";
import type { SongAction } from "../lib/songReducer";

interface UseGridEditingArguments {
	activeTrack: Track | undefined;
	slots: ProgressionSlot[];
	activeSlot: number;
	setActiveSlot: Dispatch<SetStateAction<number>>;
	selection: RangeSelection | null;
	setSelection: Dispatch<SetStateAction<RangeSelection | null>>;
	dispatch: Dispatch<SongAction | { type: "undo" } | { type: "redo" }>;
	isPlaying: boolean;
	startPlayback: (fromStep?: number, skipLeadIn?: boolean) => void;
	stopPlayback: () => void;
	copySelection: () => void;
	cutSelection: () => void;
	pasteAtSelection: () => Promise<void>;
}

// Keyboard-first grid editing: digit entry, navigation, clipboard shortcuts,
// space-to-play — plus the window-level undo/redo listener.
//
// Horizontal navigation walks the EXPANDED timeline (the progression's slot
// list), not the raw measure order, so moving right off the end of a section
// lands in whatever the arrangement plays next — including the next pass of a
// section that repeats.
export function useGridEditing({
	activeTrack,
	slots,
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

	const slotFor = (measure: number) => slotForMeasure(slots, measure, activeSlot);

	const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		// Don't hijack typing in text fields (section names, comments, measure notes).
		const target = event.target as HTMLElement;
		if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

		const focusStep = () => {
			if (!selection) return 0;
			const slot = slotFor(selection.focus.measure);
			return slot ? stepOf(slot, selection.focus.measure, selection.focus.column) : 0;
		};

		if (event.key === " ") {
			event.preventDefault();
			if (isPlaying) stopPlayback();
			// Jumping to a cursor skips the lead-in; from the top it rolls through.
			else startPlayback(focusStep(), selection !== null);
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
			}
			// Any other chord (Ctrl+S, Ctrl+H…) belongs to the browser — falling
			// through would let the plain-key branches edit the focused cell.
			return;
		}

		if (!selection || !activeTrack) return;
		const { focus } = selection;
		const currentSlot = slotFor(focus.measure);

		const setFocus = (position: CellPos, extend: boolean) => {
			setSelection((previous) =>
				extend && previous ? { anchor: previous.anchor, focus: position } : { anchor: position, focus: position },
			);
		};

		const stepBy = (delta: number, extend: boolean): boolean => {
			if (!currentSlot) return false;
			const at = locateStep(slots, stepOf(currentSlot, focus.measure, focus.column) + delta);
			if (!at) return false;
			setActiveSlot(at.slot.index);
			setFocus({ measure: at.measure, column: at.column, stringIndex: focus.stringIndex }, extend);
			return true;
		};

		const editFocus = (value: string | null) => {
			dispatch({
				type: "set-cell",
				trackId: activeTrack.id,
				measure: focus.measure,
				column: focus.column,
				stringIndex: focus.stringIndex,
				value,
			});
		};

		const currentValue = () => activeTrack.measures[focus.measure]?.[focus.column]?.[focus.stringIndex] ?? null;

		if (event.key >= "0" && event.key <= "9") {
			event.preventDefault();
			editFocus(typeDigit(currentValue(), event.key));
			setSelection({ anchor: focus, focus });
			return;
		}

		if (event.key === "h" || event.key === "H") {
			event.preventDefault();
			const current = currentValue();
			if (current !== null && current !== "") editFocus(toggleHarmonic(current));
			return;
		}

		// Sustain: ring this note for 1 → 2 → 4 bars, then off.
		if (event.key === "s" || event.key === "S") {
			event.preventDefault();
			const current = currentValue();
			if (current !== null && current !== "") editFocus(cycleRing(current));
			return;
		}

		if (event.key === "Backspace" || event.key === "Delete") {
			event.preventDefault();
			dispatch({ type: "clear-range", trackId: activeTrack.id, rect: normalizeRect(selection) });
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			if (focus.stringIndex > 0)
				setFocus({ ...focus, stringIndex: focus.stringIndex - 1 }, event.shiftKey);
			return;
		}
		if (event.key === "ArrowDown") {
			event.preventDefault();
			if (focus.stringIndex < activeTrack.tuning.length - 1)
				setFocus({ ...focus, stringIndex: focus.stringIndex + 1 }, event.shiftKey);
			return;
		}
		if (event.key === "ArrowLeft" || (event.key === "Tab" && event.shiftKey)) {
			event.preventDefault();
			stepBy(-1, event.shiftKey);
			return;
		}
		if (event.key === "ArrowRight" || event.key === "Tab") {
			event.preventDefault();
			if (stepBy(1, event.shiftKey)) return;
			// Past the last step of the arrangement the grid grows under the
			// cursor: a bar joins whichever section is played last.
			const lastSlot = slots[slots.length - 1];
			if (!lastSlot) return;
			const grewAfter = lastSlot.startMeasure + lastSlot.span - 1;
			dispatch({ type: "insert-measure", after: grewAfter });
			setFocus({ measure: grewAfter + 1, column: 0, stringIndex: focus.stringIndex }, false);
			return;
		}
		if (event.key === "Escape") setSelection(null);
	};

	return { handleGridKeyDown };
}
