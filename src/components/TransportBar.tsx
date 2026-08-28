import type { MouseEvent } from "react";
import ShortcutHelp from "./ShortcutHelp";
import { PlayIcon, SkipStartIcon, StopIcon } from "./Icons";

interface Props {
	bpm: number;
	onBpmChange: (bpm: number) => void;
	isPlaying: boolean;
	hasSelection: boolean;
	progress: number | null;
	onPlay: () => void;
	onPlayFromStart: () => void;
	onStop: () => void;
	onSeek: (fraction: number) => void;
	onAddMeasure: () => void;
	onAddSection: () => void;
}

const addBtn = "btn text-[13px] px-2.5 py-1.5";

// Fixed to the bottom of the viewport, Songsterr-style: a scrub rule the
// full width of the bar, every editing/playback action within one thumb's
// reach beneath it. A true three-column grid (not a centered flex row with
// one side pulled out via absolute positioning) so transport stays
// genuinely centered regardless of how wide the side groups are.
export default function TransportBar({
	bpm,
	onBpmChange,
	isPlaying,
	hasSelection,
	progress,
	onPlay,
	onPlayFromStart,
	onStop,
	onSeek,
	onAddMeasure,
	onAddSection,
}: Props) {
	const handleSeek = (e: MouseEvent<HTMLDivElement>) => {
		const rect = e.currentTarget.getBoundingClientRect();
		onSeek(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
	};

	// z-50 on the bar: it is a stacking context, so its shortcut-help popover
	// can never exceed the bar's own layer — at z-30 the Sound panel (z-40)
	// painted over the popover. Modals/toast stay above via DOM order.
	return (
		<div
			data-keep-selection
			className="fixed bottom-0 left-0 right-0 z-50 bg-plate-raised border-t border-hairline-strong"
		>
			<div className="h-1.5 bg-plate cursor-pointer group" onClick={handleSeek} title="Seek">
				<div
					className="h-full bg-accent transition-[width] duration-100 ease-linear group-hover:brightness-110"
					style={{ width: `${(progress ?? 0) * 100}%` }}
				/>
			</div>
			{/* Full-width row (no centered max-w column): +Measure/+Section hug the
			    left screen edge, BPM/help the right, play stays truly centered. */}
			<div className="grid grid-cols-[1fr_auto_1fr] items-center px-4 py-1.5">
				<div className="flex items-center gap-0.5">
					<button className={addBtn} onClick={onAddMeasure}>
						+ Measure
					</button>
					<button className={addBtn} onClick={onAddSection}>
						+ Section
					</button>
				</div>

				<div className="flex items-center gap-2 justify-self-center">
					<button
						className="btn px-2 py-1.5"
						onClick={onPlayFromStart}
						title="Play from the start"
						disabled={isPlaying}
					>
						<SkipStartIcon />
					</button>
					{isPlaying ? (
						<button
							className="bg-ink text-plate text-[13px] font-medium px-5 py-1.5 hover:bg-ink-soft transition-colors"
							onClick={onStop}
						>
							<StopIcon className="mr-1.5" /> Stop
						</button>
					) : (
						<button
							className="bg-accent text-accent-ink text-[13px] font-medium px-5 py-1.5 hover:opacity-90 transition-opacity"
							onClick={onPlay}
							title={hasSelection ? "Play from the selected cell" : "Play from the start"}
						>
							<PlayIcon className="mr-1.5" /> {hasSelection ? "Play from cell" : "Play"}
						</button>
					)}
				</div>

				<div className="flex items-center gap-1 justify-self-end">
					<label className="flex items-center gap-2 text-[13px] text-ink-soft">
						BPM
						<input
							className="bg-transparent border-b border-hairline-strong focus:border-accent outline-none text-ink text-[13px] font-mono px-1 py-0.5 w-12 text-center"
							type="number"
							min={30}
							max={300}
							value={bpm}
							onChange={(e) => onBpmChange(Number(e.target.value) || 100)}
						/>
					</label>
					<ShortcutHelp />
				</div>
			</div>
		</div>
	);
}
