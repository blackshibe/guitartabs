import { Fragment, useState } from "react";
import type { SectionRange } from "../types";
import { tieColor } from "../lib/sectionColors";
import { InsertIcon } from "./Icons";

interface Props {
	sectionRanges: SectionRange[];
	activeSectionId: number | null;
	canPaste: boolean;
	onJump: (id: number) => void;
	onAddAt: (m: number) => void;
	onPasteAt: (m: number) => void;
	onLink: (id: number, to: number) => void;
	onUnlink: (id: number) => void;
}

function rootIdOf(sec: SectionRange): number {
	return sec.linkTo ?? sec.id;
}

// The jump bar doubles as the placement surface: every gap between sections
// (including both ends) can grow a new section or receive the copied one.
// Linked sections carry a shared tie color underline and a ⌒ mark, the
// engraving world's own vocabulary for "these mirror each other."
export default function SectionNav({
	sectionRanges,
	activeSectionId,
	canPaste,
	onJump,
	onAddAt,
	onPasteAt,
	onLink,
	onUnlink,
}: Props) {
	const [linkMenuFor, setLinkMenuFor] = useState<number | null>(null);

	// A slim always-present hover strip between chips; the actual insert/paste
	// buttons float above it so the gap never pushes the chips apart.
	const gap = (m: number, key: string) => (
		<span
			key={key}
			className="relative w-1.5 self-stretch flex items-center justify-center opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity hover:z-30 focus-within:z-30"
		>
			<span className="absolute left-1/2 -translate-x-1/2 flex items-center bg-plate-raised border border-hairline-strong shadow-[0_4px_12px_rgba(0,0,0,0.4)]">
				<button
					className="text-ink-soft hover:text-ink text-xs px-1.5 py-1"
					title="Insert section here"
					onClick={() => onAddAt(m)}
				>
					+
				</button>
				{canPaste && (
					<button
						className="text-ink-soft hover:text-accent text-xs px-1.5 py-1"
						title="Paste copied section here"
						onClick={() => onPasteAt(m)}
					>
						<InsertIcon />
					</button>
				)}
			</span>
		</span>
	);

	return (
		<div className="flex flex-wrap items-start gap-y-1.5 mb-4">
			{gap(sectionRanges[0]?.startMeasure ?? 0, "gap-start")}
			{sectionRanges.map((sec) => {
				const span = sec.endMeasure - sec.startMeasure + 1;
				const linked = sec.linkTo != null;
				const groupRoot = rootIdOf(sec);
				const inGroup = sectionRanges.some((r) => r.id !== sec.id && rootIdOf(r) === groupRoot);
				const candidates = sectionRanges.filter(
					(r) => r.id !== sec.id && r.endMeasure - r.startMeasure + 1 === span && rootIdOf(r) !== groupRoot,
				);
				return (
					<Fragment key={sec.id}>
						<span className="relative flex flex-col items-stretch">
							<button
								className={
									"text-xs px-2.5 py-1.5 bg-plate-sunken border border-b-2 transition-colors " +
									(sec.id === activeSectionId
										? "border-hairline-strong border-b-accent text-ink"
										: "border-hairline-strong text-ink-soft hover:text-ink hover:border-ink-faint")
								}
								style={inGroup ? { borderBottomColor: tieColor(sec.colorIndex) } : undefined}
								onClick={() => onJump(sec.id)}
								title={
									inGroup
										? linked
											? `Linked — mirrors "${sectionRanges.find((r) => r.id === groupRoot)?.name}"`
											: "Link source"
										: undefined
								}
							>
								{inGroup && <span style={{ color: tieColor(sec.colorIndex) }}>⌒ </span>}
								{sec.name}
							</button>
							<button
								className="text-[11px] leading-none py-0.5 text-ink-soft hover:text-accent"
								title={linked ? "Unlink section" : "Link to another section"}
								onClick={(e) => {
									e.stopPropagation();
									if (linked) onUnlink(sec.id);
									else setLinkMenuFor((v) => (v === sec.id ? null : sec.id));
								}}
							>
								{linked ? "unlink" : "link"}
							</button>
							{linkMenuFor === sec.id && (
								<div className="absolute top-full left-0 z-40 mt-0.5 bg-plate border border-ink-faint shadow-[0_6px_16px_rgba(28,27,25,0.18)] min-w-[160px]">
									{candidates.length === 0 ? (
										<div className="text-[11px] text-ink-faint px-2.5 py-2">
											No same-length section to link
										</div>
									) : (
										candidates.map((c) => (
											<button
												key={c.id}
												className="block w-full text-left text-[11px] text-ink-soft hover:bg-plate-raised hover:text-ink px-2.5 py-1.5"
												onClick={() => {
													onLink(sec.id, c.id);
													setLinkMenuFor(null);
												}}
											>
												{c.name}
											</button>
										))
									)}
								</div>
							)}
						</span>
						{gap(sec.endMeasure + 1, `gap-${sec.id}`)}
					</Fragment>
				);
			})}
		</div>
	);
}
