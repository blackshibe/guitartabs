import { useEffect, useRef, useState } from "react";
import { slotForMeasure, type ProgressionSlot } from "../lib/progression";
import type { CellPos, RangeSelection, Track } from "../types";

// The grid selection: a {anchor, focus} rect over cells, plus the drag and
// focus plumbing that keeps it usable.
//
// Cells are addressed by SOURCE measure, but the same measure can be on
// screen several times over (a section the progression plays more than once),
// so the hook also tracks which rendered slot the cursor is actually in. The
// selection tint shows in every copy — they are the same bars — while the
// focus caret only ever draws in the active slot.
export function useSelection(activeTrack: Track | undefined, measureCount: number, slots: ProgressionSlot[]) {
	const [selection, setSelection] = useState<RangeSelection | null>(null);
	const [activeSlot, setActiveSlot] = useState(0);
	const draggingRef = useRef(false);
	const gridRef = useRef<HTMLDivElement | null>(null);

	const focusGrid = () => gridRef.current?.focus({ preventScroll: true });

	// Selection survives clicks on the toolbar (play-from-cell, + Section) but
	// clears anywhere else outside the grid.
	useEffect(() => {
		const onMouseDown = (event: MouseEvent) => {
			if (!(event.target as HTMLElement).closest("[data-grid],[data-keep-selection]")) setSelection(null);
		};
		const onMouseUp = () => {
			draggingRef.current = false;
		};
		document.addEventListener("mousedown", onMouseDown);
		document.addEventListener("mouseup", onMouseUp);
		return () => {
			document.removeEventListener("mousedown", onMouseDown);
			document.removeEventListener("mouseup", onMouseUp);
		};
	}, []);

	// Structural edits and undo can invalidate the selection — drop it.
	useEffect(() => {
		setSelection((previous) => {
			if (!previous) return previous;
			const stringCount = activeTrack?.tuning.length ?? 0;
			const isValid = (position: CellPos) => position.measure < measureCount && position.stringIndex < stringCount;
			return isValid(previous.anchor) && isValid(previous.focus) ? previous : null;
		});
	}, [measureCount, activeTrack]);

	// Rearranging the progression can retire OR reshuffle the slot the cursor
	// was sitting in (move-entry keeps the count but renumbers the slots) —
	// re-home the caret to a slot that still shows its measure.
	useEffect(() => {
		setActiveSlot((previous) => {
			const slot = slots[previous];
			if (!selection) return slot ? previous : 0;
			const { measure } = selection.focus;
			if (slot && measure >= slot.startMeasure && measure < slot.startMeasure + slot.span) return previous;
			return slotForMeasure(slots, measure)?.index ?? 0;
		});
	}, [slots, selection]);

	const handleCellMouseDown = (position: CellPos, slotIndex: number, shiftKey: boolean) => {
		draggingRef.current = true;
		setActiveSlot(slotIndex);
		setSelection((previous) =>
			shiftKey && previous ? { anchor: previous.anchor, focus: position } : { anchor: position, focus: position },
		);
		focusGrid();
	};

	const handleCellEnter = (position: CellPos, slotIndex: number) => {
		if (!draggingRef.current) return;
		setActiveSlot(slotIndex);
		setSelection((previous) => (previous ? { anchor: previous.anchor, focus: position } : previous));
	};

	return {
		selection,
		setSelection,
		activeSlot,
		setActiveSlot,
		gridRef,
		focusGrid,
		handleCellMouseDown,
		handleCellEnter,
	};
}
