import { useState } from "react";
import type { Song } from "../types";

export type ConflictChoice = "overwrite" | "lyrics" | "skip";

interface Props {
	conflicts: Song[];
	existing: Song[];
	onConfirm: (choices: Record<string, ConflictChoice>) => void;
}

const CHOICES: [ConflictChoice, string][] = [
	["overwrite", "Overwrite"],
	["lyrics", "Lyrics only"],
	["skip", "Skip"],
];

// Shown when an import contains songs whose ids already exist in the
// library: per song, overwrite the saved copy, take only the file's lyrics
// onto it (tabs untouched), or leave it alone.
export default function ImportConflictDialog({ conflicts, existing, onConfirm }: Props) {
	const [choices, setChoices] = useState<Record<string, ConflictChoice>>(() =>
		Object.fromEntries(conflicts.map((song) => [song.id, "overwrite" as ConflictChoice])),
	);
	const skipAll = () => onConfirm(Object.fromEntries(conflicts.map((song) => [song.id, "skip" as ConflictChoice])));
	const applying = Object.values(choices).filter((choice) => choice !== "skip").length;

	const stamp = (t: number) => new Date(t).toLocaleString();

	return (
		<div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-5" onClick={skipAll}>
			<div
				className="bg-plate border border-ink-faint p-6 w-full max-w-md max-h-[85vh] overflow-y-auto shadow-[0_10px_28px_rgba(28,27,25,0.28)]"
				onClick={(e) => e.stopPropagation()}
			>
				<h3 className="font-display text-xl text-ink mb-4">Already in the library</h3>

				<div className="flex flex-col border-t border-hairline mb-5">
					{conflicts.map((song) => {
						const current = existing.find((s) => s.id === song.id);
						return (
							<div key={song.id} className="border-b border-hairline px-1 py-2.5">
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
								<div className="flex mt-2">
									{CHOICES.map(([choice, label]) => (
										<button
											key={choice}
											className={
												"text-xs px-2.5 py-1 border-b-2 transition-colors " +
												(choices[song.id] === choice
													? "bg-plate-sunken border-b-accent text-ink"
													: "bg-plate-raised border-b-hairline-strong text-ink-soft hover:text-ink")
											}
											onClick={() => setChoices((prev) => ({ ...prev, [song.id]: choice }))}
										>
											{label}
										</button>
									))}
								</div>
							</div>
						);
					})}
				</div>

				<div className="flex items-center gap-3">
					<button
						className="bg-accent text-accent-ink text-xs font-medium px-2.5 py-1.5 hover:opacity-90 disabled:opacity-40"
						disabled={applying === 0}
						onClick={() => onConfirm(choices)}
					>
						Import {applying}
					</button>
					<button className="btn text-xs px-2 py-1.5" onClick={skipAll}>
						Skip all
					</button>
				</div>
			</div>
		</div>
	);
}
