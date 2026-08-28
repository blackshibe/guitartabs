import { type KeyboardEvent, type RefObject, useEffect } from "react";
import type { Playhead, RangeSelection, SectionRange, Track } from "../types";
import { midiToNoteName } from "../lib/tunings";
import { COLS_PER_MEASURE, chunkMeasures, stringMidi } from "../lib/instruments";
import { globalCol, normalizeRect } from "../lib/clipboard";
import { tieColor } from "../lib/sectionColors";
import { CloseIcon } from "./Icons";

interface Props {
	className?: string;
	track: Track;
	sectionRanges: SectionRange[];
	measureCount: number;
	measureNotes: string[];
	canDeleteSection: boolean;
	selected: RangeSelection | null;
	playhead: Playhead | null;
	gridRef: RefObject<HTMLDivElement | null>;
	onCellMouseDown: (m: number, c: number, s: number, shiftKey: boolean) => void;
	onCellEnter: (m: number, c: number, s: number) => void;
	onDeleteMeasure: (m: number) => void;
	onInsertMeasureAfter: (m: number) => void;
	onRenameSection: (id: number, name: string) => void;
	onCommentChange: (id: number, comment: string) => void;
	onTrackCommentChange: (id: number, comment: string) => void;
	onCopySection: (id: number) => void;
	onDeleteSection: (id: number) => void;
	onSetTrackLoop: (sectionId: number, unit: number | null) => void;
	onSetMeasureNote: (m: number, text: string) => void;
	onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
	registerSectionRef: (id: number, element: HTMLDivElement | null) => void;
}

const headerBtn = "btn text-xs px-2 py-1";
const dangerHeaderBtn = "btn btn-danger text-xs px-2 py-1";
const CELL_W = 28;

export default function TabGrid({
	className = "",
	track,
	sectionRanges,
	measureCount,
	measureNotes,
	canDeleteSection,
	selected,
	playhead,
	gridRef,
	onCellMouseDown,
	onCellEnter,
	onDeleteMeasure,
	onInsertMeasureAfter,
	onRenameSection,
	onCommentChange,
	onTrackCommentChange,
	onCopySection,
	onDeleteSection,
	onSetTrackLoop,
	onSetMeasureNote,
	onKeyDown,
	registerSectionRef,
}: Props) {
	const rect = selected ? normalizeRect(selected) : null;
	const focus = selected?.focus ?? null;

	// Keep the playing line in view.
	useEffect(() => {
		if (!playhead) return;
		const root = gridRef.current;
		if (!root) return;
		for (const element of root.querySelectorAll<HTMLElement>("[data-line-start]")) {
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
	// highlight — one grid, one way of marking "the current position."
	const cellClass = (measure: number, column: number, stringIndex: number, hasValue: boolean): string => {
		const cellColumn = globalCol(measure, column);
		const inRect =
			rect !== null &&
			cellColumn >= rect.startColumn &&
			cellColumn <= rect.endColumn &&
			stringIndex >= rect.startString &&
			stringIndex <= rect.endString;
		const isFocus =
			focus !== null && focus.measure === measure && focus.column === column && focus.stringIndex === stringIndex;
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

	// Left margin (40px note-name column + 6px gap + 14px opening bar) plus one
	// measure block (CELL_W*8 cells + 14px trailing bar) per line, repeated per
	// measure index — the geometry every row shares (header, annotation, and
	// string rows all use the same stride so nothing drifts), and the geometry
	// the playhead overlay glides across.
	const playheadLeft = (lineMeasures: number[]): number | null => {
		if (!playhead) return null;
		const lineIndex = lineMeasures.indexOf(playhead.measure);
		if (lineIndex === -1) return null;
		return 60 + lineIndex * (CELL_W * COLS_PER_MEASURE + 14) + playhead.column * CELL_W;
	};

	return (
		<div
			ref={gridRef}
			data-grid
			className={`outline-none overflow-x-auto ${className}`}
			onKeyDown={onKeyDown}
			tabIndex={0}
		>
			{sectionRanges.map((sec) => {
				const span = sec.endMeasure - sec.startMeasure + 1;
				const measureIndices = Array.from({ length: span }, (_, off) => sec.startMeasure + off);
				const linked = sec.linkTo != null;
				const loopUnit = track.loops?.[sec.id];

				return (
					<div
						className="min-w-fit bg-plate-raised border border-hairline-strong border-l-[3px] p-4 mt-4 first:mt-0 mb-3 scroll-mt-[190px]"
						key={sec.id}
						ref={(element) => registerSectionRef(sec.id, element)}
					>
						<div className="flex items-center flex-wrap gap-2 mb-2.5">
							{linked && <span style={{ color: tieColor(sec.colorIndex) }}>⌒</span>}
							<input
								className="bg-transparent border-b border-transparent hover:border-hairline focus:border-accent outline-none font-display text-lg text-ink px-1 py-0.5 flex-none w-[220px]"
								value={sec.name}
								onChange={(e) => onRenameSection(sec.id, e.target.value)}
								onKeyDown={headerInputKeyDown}
							/>
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
							{span > 1 && (
								<label className="flex items-center gap-1.5 text-[11px] text-ink-faint font-mono uppercase tracking-wide">
									𝄆 loop
									<select
										className="bg-transparent border-b border-hairline-strong text-ink-soft text-[11px] font-mono px-0.5 py-0.5 outline-none focus:border-accent"
										value={loopUnit ?? ""}
										onChange={(e) =>
											onSetTrackLoop(
												sec.id,
												e.target.value === "" ? null : Number(e.target.value),
											)
										}
									>
										<option value="">off</option>
										{Array.from({ length: span - 1 }, (_, i) => i + 1).map((u) => (
											<option key={u} value={u}>
												{u} bar{u === 1 ? "" : "s"} ×{Math.ceil(span / u)}
											</option>
										))}
									</select>
								</label>
							)}
							{canDeleteSection && (
								<button
									className={dangerHeaderBtn}
									onClick={() => onDeleteSection(sec.id)}
									title="Remove section marker (bars stay)"
								>
									remove marker
								</button>
							)}
						</div>

						<div className="flex flex-wrap items-start gap-x-4 mb-2.5">
							<textarea
								rows={1}
								className="field-sizing-content resize-none bg-transparent border-b border-hairline focus:border-accent outline-none text-xs text-ink-soft placeholder-ink-faint px-1 py-1 w-full max-w-[380px]"
								value={sec.comment ?? ""}
								placeholder="Notes"
								onChange={(e) => onCommentChange(sec.id, e.target.value)}
								onKeyDown={headerInputKeyDown}
							/>
							<textarea
								rows={1}
								className="field-sizing-content resize-none bg-transparent border-b border-hairline focus:border-accent outline-none text-xs text-ink-soft placeholder-ink-faint px-1 py-1 w-full max-w-[380px]"
								value={sec.trackComments?.[track.id] ?? ""}
								placeholder={`Notes · ${track.name}`}
								onChange={(e) => onTrackCommentChange(sec.id, e.target.value)}
								onKeyDown={headerInputKeyDown}
							/>
						</div>

						{chunkMeasures(measureIndices).map((lineMeasures) => (
							<div
								className="mb-4 scroll-mt-[190px]"
								key={lineMeasures[0]}
								data-line-start={lineMeasures[0]}
								data-line-end={lineMeasures[lineMeasures.length - 1]}
							>
								{/* Header + annotation rows share the string rows' exact
                    stride (one 14px barline slot between measures, not two)
                    so measure numbers and notes stay over their measures. */}
								<div className="flex items-center">
									<span className="w-10 shrink-0 mr-1.5" />
									<span className="w-3.5 shrink-0 text-center text-ink-faint">
										{loopUnit != null && lineMeasures[0] === sec.startMeasure ? "𝄆" : ""}
									</span>
									{lineMeasures.map((m) => {
										const off = m - sec.startMeasure;
										const mirrored = loopUnit != null && off >= loopUnit;
										const unitEnd = loopUnit != null && off === Math.min(loopUnit, span) - 1;
										return (
											<div className="flex items-center shrink-0" key={m}>
												<span
													className={
														"flex items-center gap-1 shrink-0 text-xs font-mono " +
														(mirrored ? "text-ink-faint/70" : "text-ink-faint")
													}
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
												<span className="w-3.5 shrink-0 text-center text-ink-faint">
													{unitEnd ? "𝄇" : ""}
												</span>
											</div>
										);
									})}
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
									{playheadLeft(lineMeasures) !== null && (
										<div
											className="absolute top-0 bottom-0 border-l-2 border-accent bg-accent/10 transition-[left] duration-150 ease-out pointer-events-none z-10"
											style={{ left: playheadLeft(lineMeasures) as number, width: CELL_W }}
										/>
									)}
									{track.tuning.map((str, s) => (
										<div className="flex items-center" key={s}>
											<span className="w-10 shrink-0 text-right mr-1.5 text-ink-soft text-[13px] font-mono">
												{midiToNoteName(stringMidi(str))}
											</span>
											<span className="w-3.5 shrink-0 text-center text-hairline-strong">|</span>
											{lineMeasures.map((m) => (
												<span className="flex items-center shrink-0" key={m}>
													{track.measures[m].map((col, c) => {
														const value = col[s];
														const label = value === null || value === "" ? "-" : value;
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
																)}
																onMouseDown={(e) => {
																	e.preventDefault();
																	onCellMouseDown(m, c, s, e.shiftKey);
																}}
																onMouseEnter={() => onCellEnter(m, c, s)}
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
