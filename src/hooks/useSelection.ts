import { useEffect, useRef, useState } from "react";
import type { CellPos, RangeSelection, Track } from "../types";

// The grid selection: a {anchor, focus} rect over cells, plus the drag and
// focus plumbing that keeps it usable.
export function useSelection(activeTrack: Track | undefined, measureCount: number) {
	const [selection, setSelection] = useState<RangeSelection | null>(null);
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

	const handleCellMouseDown = (measure: number, column: number, stringIndex: number, shiftKey: boolean) => {
		draggingRef.current = true;
		const position: CellPos = { measure, column, stringIndex };
		setSelection((previous) =>
			shiftKey && previous ? { anchor: previous.anchor, focus: position } : { anchor: position, focus: position },
		);
		focusGrid();
	};

	const handleCellEnter = (measure: number, column: number, stringIndex: number) => {
		if (!draggingRef.current) return;
		setSelection((previous) =>
			previous ? { anchor: previous.anchor, focus: { measure, column, stringIndex } } : previous,
		);
	};

	return { selection, setSelection, gridRef, focusGrid, handleCellMouseDown, handleCellEnter };
}
