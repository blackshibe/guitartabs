import { type KeyboardEvent, type RefObject, useEffect } from "react";
import type { CellPos, Playhead, RangeSelection, Track } from "../types";
import { midiToNoteName } from "../lib/tunings";
import { COLS_PER_MEASURE, chunkMeasures, stringMidi } from "../lib/instruments";
import { globalCol, normalizeRect } from "../lib/clipboard";
import { cellRingBars, displayCellValue } from "../lib/cellValue";
import type { ProgressionSlot } from "../lib/progression";
import { tieColor } from "../lib/sectionColors";
import { CloseIcon } from "./Icons";

interface Props {
	className?: string;
	track: Track;
	/** the arrangement, expanded — one block is drawn per slot, in play order */
	slots: ProgressionSlot[];
	activeSlot: number;
	measureCount: number;
	measureNotes: string[];
	canDeleteSection: boolean;
	/** milliseconds per grid column at the current tempo — paces the playhead glide */
	stepDurationMs: number;
	selected: RangeSelection | null;
	playhead: Playhead | null;
	gridRef: RefObject<HTMLDivElement | null>;
	onCellMouseDown: (position: CellPos, slotIndex: number, shiftKey: boolean) => void;
	onCellEnter: (position: CellPos, slotIndex: number) => void;
	onDeleteMeasure: (m: number) => void;
	onInsertMeasureAfter: (m: number) => void;
	onRenameSection: (id: number, name: string) => void;
	onSetSectionBpm: (id: number, bpm: number | null) => void;
	songBpm: number;
	onTrackCommentChange: (id: number, comment: string) => void;
	onCopySection: (id: number) => void;
	onDeleteSection: (id: number) => void;
	onAddToProgression: (sectionId: number) => void;
	onSetMeasureNote: (m: number, text: string) => void;
	onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
}

const headerBtn = "btn text-xs px-2 py-1";
const dangerHeaderBtn = "btn btn-danger text-xs px-2 py-1";
const CELL_W = 28;
/** left margin: 40px note-name column + 6px gap + 14px opening bar */
const GUTTER = 60;
/** one measure block: its cells plus the trailing barline slot */
const MEASURE_W = CELL_W * COLS_PER_MEASURE + 14;

// The score renders the ARRANGEMENT, not the raw measure timeline: one block
// per progression slot, so a section played three times is three blocks over
// the same bars. Repeat counts live in the progression view; there are no
// loop controls here.
export default function TabGrid({
	className = "",
	track,
	slots,
	activeSlot,
	measureCount,
	measureNotes,
	canDeleteSection,
	stepDurationMs,
	selected,
	playhead,
	gridRef,
	onCellMouseDown,
	onCellEnter,
	onDeleteMeasure,
	onInsertMeasureAfter,
	onRenameSection,
	onSetSectionBpm,
	songBpm,
	onTrackCommentChange,
	onCopySection,
	onDeleteSection,
	onAddToProgression,
	onSetMeasureNote,
	onKeyDown,
}: Props) {
	const rect = selected ? normalizeRect(selected) : null;
	const focus = selected?.focus ?? null;

	// Keep the playing line in view — matched on the slot as well as the
	// measure, since a repeated section is on screen more than once.
	useEffect(() => {
		if (!playhead) return;
		const root = gridRef.current;
		if (!root) return;
		for (const element of root.querySelectorAll<HTMLElement>("[data-line-start]")) {
			if (Number(element.dataset.slot) !== playhead.slot) continue;
			const start = Number(element.dataset.lineStart);
			const end = Number(element.dataset.lineEnd);
			if (playhead.measure >= start && playhead.measure <= end) {
				element.scrollIntoView({ block: "nearest", behavior: "smooth" });
				break;
			}
		}
	}, [playhead, gridRef]);

	// Enter/Escape hands focus back to the grid so keys keep working.
	const headerInputKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
		if (e.key === "Enter" || e.key === "Escape") {
			e.preventDefault();
			(e.target as HTMLElement).blur();
			gridRef.current?.focus({ preventScroll: true });
		}
	};

	// The focused cell reads as a caret (a vertical line at its leading edge),
	// the same visual language as the playhead rule, rather than a boxed
	// highlight — one grid, one way of marking "the current position." The
	// range tint shows in every copy of a repeated section (they are the same
	// bars); only the caret is pinned to the slot the cursor is actually in.
	const cellClass = (
		measure: number,
		column: number,
		stringIndex: number,
		hasValue: boolean,
		inActiveSlot: boolean,
	): string => {
		const cellColumn = globalCol(measure, column);
		const inRect =
			rect !== null &&
			cellColumn >= rect.startColumn &&
			cellColumn <= rect.endColumn &&
			stringIndex >= rect.startString &&
			stringIndex <= rect.endString;
		const isFocus =
			inActiveSlot &&
			focus !== null &&
			focus.measure === measure &&
			focus.column === column &&
			focus.stringIndex === stringIndex;
		return (
			"relative h-[27px] shrink-0 border-0 border-b border-hairline text-[13px] p-0 m-0 select-none font-mono transition-colors duration-150 ease-out " +
			(isFocus
				? "border-l-2 border-l-accent bg-accent/10"
				: inRect
					? "bg-accent/10"
					: "bg-transparent hover:bg-plate-sunken") +
			" " +
			(hasValue ? "text-ink font-semibold" : "text-ink-faint")
		);
	};

	// Every row (header, annotation, strings) shares this stride, so measure
	// numbers and notes stay over their measures — and it is the geometry the
	// playhead overlay and the sustain rules are drawn against.
	const cellLeft = (lineIndex: number, column: number): number => GUTTER + lineIndex * MEASURE_W + column * CELL_W;

	const playheadLeft = (lineMeasures: number[], slotIndex: number): number | null => {
		if (!playhead || playhead.slot !== slotIndex) return null;
		const lineIndex = lineMeasures.indexOf(playhead.measure);
		if (lineIndex === -1) return null;
		return cellLeft(lineIndex, playhead.column);
	};

	// A sustained note draws as a rule running out from the note for the bars
	// it rings — cut short by the next note on the same string, and clipped at
	// the end of the printed line.
	const ringRules = (lineMeasures: number[], stringIndex: number): { left: number; width: number }[] => {
		const columns = lineMeasures.length * COLS_PER_MEASURE;
		const valueAt = (position: number) =>
			track.measures[lineMeasures[Math.floor(position / COLS_PER_MEASURE)]]?.[position % COLS_PER_MEASURE]?.[
				stringIndex
			] ?? null;
		const rules: { left: number; width: number }[] = [];
		for (let position = 0; position < columns; position++) {
			const bars = cellRingBars(valueAt(position));
			if (bars === 0) continue;
			let end = Math.min(position + bars * COLS_PER_MEASURE - 1, columns - 1);
			for (let ahead = position + 1; ahead <= end; ahead++) {
				const next = valueAt(ahead);
				if (next !== null && next !== "") {
					end = ahead - 1;
					break;
				}
			}
			const startX = cellLeft(Math.floor(position / COLS_PER_MEASURE), position % COLS_PER_MEASURE) + CELL_W - 5;
			const endX = cellLeft(Math.floor(end / COLS_PER_MEASURE), end % COLS_PER_MEASURE) + CELL_W - 5;
			rules.push({ left: startX, width: Math.max(6, endX - startX) });
		}
		return rules;
	};

	return (
		<div
			ref={gridRef}
			data-grid
			className={`outline-none overflow-x-auto ${className}`}
			onKeyDown={onKeyDown}
			tabIndex={0}
		>
			{slots.map((slot) => {
				const sec = slot.section;
				const measureIndices = Array.from({ length: slot.span }, (_, off) => slot.startMeasure + off);
				const linked = sec.linkTo != null;
				const isActiveSlot = slot.index === activeSlot;

				return (
					<div
						className={
							"min-w-fit bg-plate-raised border border-hairline-strong border-l-[3px] p-4 mt-4 first:mt-0 mb-3 scroll-mt-[190px] " +
							(slot.unused ? "opacity-60" : "")
						}
						key={slot.index}
					>
						<div className="flex items-center flex-wrap gap-2 mb-2.5">
							{linked && <span style={{ color: tieColor(sec.colorIndex) }}>⌒</span>}
							<input
								className="bg-transparent border-b border-transparent hover:border-hairline focus:border-accent outline-none font-display text-lg text-ink px-1 py-0.5 flex-none w-[220px]"
								value={sec.name}
								onChange={(e) => onRenameSection(sec.id, e.target.value)}
								onKeyDown={headerInputKeyDown}
							/>
							<span
								className="flex items-center gap-1 text-[11px] font-mono text-ink-faint"
								title="Tempo while this section plays — blank follows the song BPM"
							>
								<input
									type="number"
									min={1}
									max={400}
									className="w-14 bg-transparent border-b border-transparent hover:border-hairline focus:border-accent outline-none text-xs text-ink-soft placeholder-ink-faint px-1 py-0.5 text-right"
									value={sec.bpm ?? ""}
									placeholder={String(songBpm)}
									onChange={(e) =>
										onSetSectionBpm(sec.id, e.target.value === "" ? null : Number(e.target.value))
									}
									onKeyDown={headerInputKeyDown}
								/>
								bpm
							</span>
							{slot.repeatCount > 1 && (
								<span className="text-[11px] font-mono text-ink-faint uppercase tracking-wide">
									𝄆 {slot.repeatIndex + 1} of {slot.repeatCount}
								</span>
							)}
							{slot.unused && (
								<button
									className={headerBtn}
									onClick={() => onAddToProgression(sec.id)}
									title="Not in the progression — add it"
								>
									+ progression
								</button>
							)}
							<button
								className={headerBtn}
								onClick={() => onCopySection(sec.id)}
								title="Copy section — paste it anywhere via ⎀ in the section bar"
							>
								copy
							</button>
							<button
								className={headerBtn}
								onClick={() => onInsertMeasureAfter(sec.endMeasure)}
								title="Add measure to this section"
							>
								+ measure
							</button>
							{canDeleteSection && (
								<button
									className={dangerHeaderBtn}
									onClick={() => onDeleteSection(sec.id)}
									title="Delete this section and its bars"
								>
									delete section
								</button>
							)}
						</div>

						<div className="flex flex-wrap items-start gap-x-4 mb-2.5">
							<textarea
								rows={1}
								className="field-sizing-content resize-none bg-transparent border-b border-hairline focus:border-accent outline-none text-xs text-ink-soft placeholder-ink-faint px-1 py-1 w-full max-w-[380px]"
								value={sec.trackComments?.[track.id] ?? ""}
								placeholder="Notes"
								onChange={(e) => onTrackCommentChange(sec.id, e.target.value)}
								onKeyDown={headerInputKeyDown}
							/>
						</div>

						{chunkMeasures(measureIndices).map((lineMeasures) => (
							<div
								className="mb-4 scroll-mt-[190px]"
								key={lineMeasures[0]}
								data-slot={slot.index}
								data-line-start={lineMeasures[0]}
								data-line-end={lineMeasures[lineMeasures.length - 1]}
							>
								{/* Header + annotation rows share the string rows' exact
                    stride (one 14px barline slot between measures, not two)
                    so measure numbers and notes stay over their measures. */}
								<div className="flex items-center">
									<span className="w-10 shrink-0 mr-1.5" />
									<span className="w-3.5 shrink-0 text-center text-ink-faint" />
									{lineMeasures.map((m) => (
										<div className="flex items-center shrink-0" key={m}>
											<span
												className="flex items-center gap-1 shrink-0 text-xs font-mono text-ink-faint"
												style={{ width: CELL_W * COLS_PER_MEASURE }}
											>
												#{m + 1}
												{measureCount > 1 && (
													<button
														className="bg-transparent hover:text-accent text-ink-soft px-1.5 leading-none"
														onClick={() => onDeleteMeasure(m)}
														title="Delete measure"
													>
														<CloseIcon />
													</button>
												)}
											</span>
											<span className="w-3.5 shrink-0 text-center text-ink-faint" />
										</div>
									))}
								</div>

								<div className="flex items-center mb-1">
									<span className="w-10 shrink-0 mr-1.5" />
									<span className="w-3.5 shrink-0" />
									{lineMeasures.map((m) => (
										<div className="flex items-center shrink-0" key={m}>
											<input
												className="bg-transparent border-b border-hairline focus:border-accent outline-none text-[11px] text-ink-soft placeholder-ink-faint/70 px-0.5"
												style={{ width: CELL_W * COLS_PER_MEASURE }}
												value={measureNotes[m] ?? ""}
												placeholder="note"
												onChange={(e) => onSetMeasureNote(m, e.target.value)}
												onKeyDown={headerInputKeyDown}
											/>
											<span className="w-3.5 shrink-0" />
										</div>
									))}
								</div>

								<div className="relative">
									{playheadLeft(lineMeasures, slot.index) !== null && (
										<div
											className="absolute top-0 bottom-0 border-l-2 border-accent bg-accent/10 pointer-events-none z-10"
											style={{
												left: playheadLeft(lineMeasures, slot.index) as number,
												width: CELL_W,
												transition: `left ${stepDurationMs}ms linear`,
											}}
										/>
									)}
									{track.tuning.map((str, s) => (
										<div className="relative flex items-center" key={s}>
											{ringRules(lineMeasures, s).map((rule) => (
												<span
													key={rule.left}
													aria-hidden
													// sustain duration drawn as a line, capped at the line end
													className="absolute top-[8px] border-b border-r border-ink-faint pointer-events-none"
													style={{ left: rule.left, width: rule.width, height: 7 }}
												/>
											))}
											<span className="w-10 shrink-0 text-right mr-1.5 text-ink-soft text-[13px] font-mono">
												{midiToNoteName(stringMidi(str))}
											</span>
											<span className="w-3.5 shrink-0 text-center text-hairline-strong">|</span>
											{lineMeasures.map((m) => (
												<span className="flex items-center shrink-0" key={m}>
													{track.measures[m].map((col, c) => {
														const value = col[s];
														const label =
															value === null || value === "" ? "-" : displayCellValue(value);
														return (
															<button
																key={c}
																data-cell
																style={{ width: CELL_W }}
																className={cellClass(
																	m,
																	c,
																	s,
																	value !== null && value !== "",
																	isActiveSlot,
																)}
																onMouseDown={(e) => {
																	e.preventDefault();
																	onCellMouseDown(
																		{ measure: m, column: c, stringIndex: s },
																		slot.index,
																		e.shiftKey,
																	);
																}}
																onMouseEnter={() =>
																	onCellEnter(
																		{ measure: m, column: c, stringIndex: s },
																		slot.index,
																	)
																}
															>
																{label}
															</button>
														);
													})}
													<span className="w-3.5 shrink-0 text-center text-hairline-strong">
														|
													</span>
												</span>
											))}
										</div>
									))}
								</div>
							</div>
						))}
					</div>
				);
			})}
		</div>
	);
}
