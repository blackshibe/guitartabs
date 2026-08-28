import type { Track } from "../types";
import { tuningLabel } from "../lib/instruments";
import { CloseIcon, GearIcon } from "./Icons";

interface Props {
	tracks: Track[];
	activeTrackId: number;
	onSelect: (id: number) => void;
	onRename: (id: number, name: string) => void;
	onEditTuning: (id: number) => void;
	onRemove: (id: number) => void;
	onAdd: () => void;
}

export default function TrackTabs({
	tracks,
	activeTrackId,
	onSelect,
	onRename,
	onEditTuning,
	onRemove,
	onAdd,
}: Props) {
	const activeTrack = tracks.find((t) => t.id === activeTrackId);

	return (
		<div className="mb-4">
			<div className="flex flex-wrap items-stretch gap-x-0.5">
				{tracks.map((t) => (
					<div
						key={t.id}
						className={
							"flex items-center gap-1 border-b-2 pl-2.5 pr-1 py-1.5 cursor-pointer transition-colors " +
							(t.id === activeTrackId
								? "border-accent bg-plate-sunken"
								: "border-transparent bg-plate-raised hover:bg-plate-sunken/60")
						}
						onClick={() => onSelect(t.id)}
					>
						<input
							className={
								"bg-transparent border-none text-sm px-0.5 py-1 w-[104px] outline-none cursor-pointer " +
								(t.id === activeTrackId ? "text-ink font-medium" : "text-ink-soft")
							}
							value={t.name}
							onChange={(e) => onRename(t.id, e.target.value)}
						/>
						<button
							className="text-ink-soft hover:text-ink text-sm px-1.5 py-0.5"
							title="Edit tuning"
							onClick={(e) => {
								e.stopPropagation();
								onEditTuning(t.id);
							}}
						>
							<GearIcon />
						</button>
						{tracks.length > 1 && (
							<button
								className="text-ink-soft hover:text-accent text-sm px-1.5 py-0.5"
								title="Remove track"
								onClick={(e) => {
									e.stopPropagation();
									onRemove(t.id);
								}}
							>
								<CloseIcon />
							</button>
						)}
					</div>
				))}
				<button
					className="text-ink-soft hover:text-ink bg-plate-raised/50 border-b-2 border-transparent hover:border-hairline-strong text-sm px-3 py-1.5"
					onClick={onAdd}
				>
					+ Track
				</button>
			</div>

			{activeTrack && (
				<div className="text-[11px] text-ink-faint mt-1.5 font-mono tracking-wide">
					{`TUNING · ${tuningLabel(activeTrack.tuning)}`.toUpperCase()}
				</div>
			)}
		</div>
	);
}
