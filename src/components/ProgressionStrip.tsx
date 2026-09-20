import type { ProgressionSlot } from "../lib/progression";
import { tieColor } from "../lib/sectionColors";

interface Props {
	slots: ProgressionSlot[];
	/** slot the cursor or playhead is in; -1 for none */
	activeSlot: number;
}

// A read-only ribbon of the arrangement, pinned above the score: what plays,
// in what order, and where you are in it. Deliberately inert — every control
// that once lived here (insert, paste, link/unlink) moved to the Progression
// view or the transport bar, so the strip stays a reference and never a
// second place to edit the song.
export default function ProgressionStrip({ slots, activeSlot }: Props) {
	const played = slots.filter((slot) => !slot.unused);
	if (played.length === 0) return null;

	// One chip per progression step, not per pass: repeats read as "×N".
	const steps = played.filter((slot) => slot.repeatIndex === 0);
	const activeEntryId = slots[activeSlot]?.entryId;

	return (
		<div className="flex flex-wrap items-center gap-1.5 mb-4" aria-label="Progression">
			{steps.map((slot) => {
				const isActive = slot.entryId === activeEntryId;
				const inGroup = slot.section.linkTo != null;
				return (
					<span
						key={slot.entryId}
						className={
							"text-xs px-2.5 py-1.5 bg-plate-sunken border border-b-2 border-hairline-strong " +
							(isActive ? "border-b-accent text-ink" : "text-ink-soft")
						}
						style={inGroup && !isActive ? { borderBottomColor: tieColor(slot.section.colorIndex) } : undefined}
					>
						{slot.section.name}
						{slot.repeatCount > 1 && (
							<span className="ml-1.5 font-mono text-ink-faint">×{slot.repeatCount}</span>
						)}
					</span>
				);
			})}
		</div>
	);
}
