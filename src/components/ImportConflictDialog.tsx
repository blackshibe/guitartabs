import { useState } from "react";
import type { Song } from "../types";

interface Props {
	conflicts: Song[];
	existing: Song[];
	onConfirm: (ids: string[]) => void;
}

// Shown when an import contains songs whose ids already exist in the
// library: pick which saved songs the file's copies should overwrite.
export default function ImportConflictDialog({ conflicts, existing, onConfirm }: Props) {
	const [checked, setChecked] = useState<Set<string>>(() => new Set(conflicts.map((s) => s.id)));

	const toggle = (id: string) => {
		setChecked((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const stamp = (t: number) => new Date(t).toLocaleString();

	return (
		<div
			className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-5"
			onClick={() => onConfirm([])}
		>
			<div
				className="bg-plate border border-ink-faint p-6 w-full max-w-md max-h-[85vh] overflow-y-auto shadow-[0_10px_28px_rgba(28,27,25,0.28)]"
				onClick={(e) => e.stopPropagation()}
			>
				<h3 className="font-display text-xl text-ink mb-4">Overwrite saved songs?</h3>

				<div className="flex flex-col border-t border-hairline mb-5">
					{conflicts.map((song) => {
						const current = existing.find((s) => s.id === song.id);
						return (
							<label
								key={song.id}
								className="flex items-start gap-2.5 border-b border-hairline px-1 py-2.5 cursor-pointer hover:bg-plate/60"
							>
								<input
									type="checkbox"
									className="mt-0.5 accent-accent"
									checked={checked.has(song.id)}
									onChange={() => toggle(song.id)}
								/>
								<span className="min-w-0">
									<span className="block text-sm text-ink font-medium truncate">
										{song.title || "Untitled Song"}
									</span>
									<span className="block text-[11px] text-ink-faint font-mono">
										file: {stamp(song.updatedAt)}
									</span>
									{current && (
										<span className="block text-[11px] text-ink-faint/70 font-mono">
											saved: {stamp(current.updatedAt)}
										</span>
									)}
								</span>
							</label>
						);
					})}
				</div>

				<div className="flex items-center gap-3">
					<button
						className="bg-accent text-accent-ink text-xs font-medium px-2.5 py-1.5 hover:opacity-90 disabled:opacity-40"
						disabled={checked.size === 0}
						onClick={() => onConfirm([...checked])}
					>
						Overwrite {checked.size}
					</button>
					<button className="btn text-xs px-2 py-1.5" onClick={() => onConfirm([])}>
						Skip all
					</button>
				</div>
			</div>
		</div>
	);
}
