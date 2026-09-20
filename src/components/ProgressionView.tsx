import { useState } from "react";
import type { ProgressionEntry, SectionRange } from "../types";
import type { ProgressionSlot } from "../lib/progression";
import { tieColor } from "../lib/sectionColors";
import { CloseIcon, MoveDownIcon, MoveUpIcon } from "./Icons";

interface Props {
	progression: ProgressionEntry[];
	sectionRanges: SectionRange[];
	slots: ProgressionSlot[];
	/** entry the playhead is inside, if any */
	activeEntryId: number | null;
	onRename: (sectionId: number, name: string) => void;
	onSetRepeat: (entryId: number, repeat: number) => void;
	onMove: (entryId: number, direction: -1 | 1) => void;
	onRemove: (entryId: number) => void;
	onAdd: (sectionId: number) => void;
	/** create a brand-new section (with a fresh bar) at the end of the timeline */
	onNewSection: () => void;
	/** bars of silence before the tab comes in; audio layers still start at the top */
	leadInBars: number;
	onSetLeadIn: (bars: number) => void;
	canPasteSection: boolean;
	onPasteSection: () => void;
}

const stepBtn = "btn text-xs px-2 py-0.5";

// The arrangement, on its own: which modules play, in what order, how many
// times. This — not the order sections sit in on the measure timeline — is
// what the tab grid renders and what playback walks, so a section can be
// reused here without duplicating a single bar of content.
export default function ProgressionView({
	progression,
	sectionRanges,
	slots,
	activeEntryId,
	onRename,
	onSetRepeat,
	onMove,
	onRemove,
	onAdd,
	onNewSection,
	leadInBars,
	onSetLeadIn,
	canPasteSection,
	onPasteSection,
}: Props) {
	const [picking, setPicking] = useState(false);
	const sectionById = new Map(sectionRanges.map((range) => [range.id, range]));
	const used = new Set(progression.map((entry) => entry.sectionId));
	const unused = sectionRanges.filter((range) => !used.has(range.id));
	const totalBars = slots.filter((slot) => !slot.unused).reduce((total, slot) => total + slot.span, 0);

	let barCursor = 0;

	return (
		<div className="mt-4 max-w-[720px]">
			<div className="flex items-baseline justify-between border-b border-hairline-strong pb-2 mb-3">
				<h2 className="font-display text-lg text-ink">Progression</h2>
				<span className="text-[11px] font-mono uppercase tracking-wide text-ink-faint">
					{progression.length} steps · {totalBars} bars
				</span>
			</div>

			<ol className="flex flex-col gap-1.5">
				{progression.map((entry, index) => {
					const section = sectionById.get(entry.sectionId);
					if (!section) return null;
					const span = section.endMeasure - section.startMeasure + 1;
					const startBar = barCursor;
					barCursor += span * entry.repeat;
					const isActive = entry.id === activeEntryId;
					return (
						<li
							key={entry.id}
							className={
								"flex items-center gap-2 bg-plate-raised border border-hairline-strong border-l-[3px] px-3 py-2 " +
								(isActive ? "border-l-accent" : "")
							}
						>
							<span className="w-7 shrink-0 text-[11px] font-mono text-ink-faint">
								{String(index + 1).padStart(2, "0")}
							</span>
							<span className="flex-1 min-w-0 flex items-center text-ink">
								{section.linkTo != null && <span style={{ color: tieColor(section.colorIndex) }}>⌒ </span>}
								<input
									className="w-full min-w-0 bg-transparent border-none outline-none text-ink"
									value={section.name}
									onChange={(event) => onRename(section.id, event.target.value)}
								/>
							</span>
							<span className="shrink-0 text-[11px] font-mono text-ink-faint">
								bars {startBar + 1}–{startBar + span * entry.repeat}
							</span>
							<span className="flex items-center gap-1 shrink-0">
								<button
									className={stepBtn}
									onClick={() => onSetRepeat(entry.id, entry.repeat - 1)}
									disabled={entry.repeat <= 1}
									title="Play one time fewer"
								>
									−
								</button>
								<span className="w-9 text-center text-[13px] font-mono text-ink">×{entry.repeat}</span>
								<button
									className={stepBtn}
									onClick={() => onSetRepeat(entry.id, entry.repeat + 1)}
									disabled={entry.repeat >= 64}
									title="Play one time more"
								>
									+
								</button>
							</span>
							<span className="flex items-center shrink-0 text-ink-soft">
								<button
									className="px-1 hover:text-ink disabled:opacity-30"
									onClick={() => onMove(entry.id, -1)}
									disabled={index === 0}
									title="Move earlier"
								>
									<MoveUpIcon />
								</button>
								<button
									className="px-1 hover:text-ink disabled:opacity-30"
									onClick={() => onMove(entry.id, 1)}
									disabled={index === progression.length - 1}
									title="Move later"
								>
									<MoveDownIcon />
								</button>
								<button
									className="px-1 hover:text-accent disabled:opacity-30"
									onClick={() => onRemove(entry.id)}
									disabled={progression.length <= 1}
									title="Remove from the progression (the section keeps its bars)"
								>
									<CloseIcon />
								</button>
							</span>
						</li>
					);
				})}
			</ol>

			<div className="mt-3">
				{picking ? (
					<div className="bg-plate-raised border border-hairline-strong p-2 flex flex-wrap gap-1.5">
						{sectionRanges.map((range) => (
							<button
								key={range.id}
								className="btn text-xs px-2 py-1"
								onClick={() => {
									onAdd(range.id);
									setPicking(false);
								}}
							>
								{range.name}
							</button>
						))}
						<button className="btn btn-danger text-xs px-2 py-1" onClick={() => setPicking(false)}>
							cancel
						</button>
					</div>
				) : (
					<div className="flex gap-1.5">
						<button className="btn text-xs px-3 py-1.5" onClick={() => setPicking(true)}>
							+ step
						</button>
						<button className="btn text-xs px-3 py-1.5" onClick={onNewSection}>
							+ new section
						</button>
						<span
							className="flex items-center gap-1 ml-auto"
							title="Bars of silence before the tab comes in — audio layers still start at the top"
						>
							<span className="text-[11px] font-mono uppercase tracking-wide text-ink-faint">lead-in</span>
							<button className={stepBtn} onClick={() => onSetLeadIn(leadInBars - 1)} disabled={leadInBars <= 0}>
								−
							</button>
							<span className="w-9 text-center text-[13px] font-mono text-ink">{leadInBars}</span>
							<button className={stepBtn} onClick={() => onSetLeadIn(leadInBars + 1)} disabled={leadInBars >= 64}>
								+
							</button>
						</span>
						{canPasteSection && (
							<button className="btn text-xs px-3 py-1.5" onClick={onPasteSection}>
								paste section
							</button>
						)}
					</div>
				)}
			</div>

			{unused.length > 0 && (
				<div className="mt-6">
					<div className="text-[11px] font-mono uppercase tracking-wide text-ink-faint mb-2">
						unused
					</div>
					<div className="flex flex-wrap gap-1.5">
						{unused.map((range) => (
							<button key={range.id} className="btn text-xs px-2 py-1" onClick={() => onAdd(range.id)}>
								+ {range.name}
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
