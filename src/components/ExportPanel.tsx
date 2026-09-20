import { useState } from "react";

interface Props {
	tracks: { id: number; name: string }[];
	buildText: (trackIds: number[]) => string;
	onExportText: (trackIds: number[]) => void;
	onExportPdf: (trackIds: number[]) => void;
}

type Format = "txt" | "pdf";

export default function ExportPanel({ tracks, buildText, onExportText, onExportPdf }: Props) {
	const [open, setOpen] = useState(false);
	const [format, setFormat] = useState<Format>("pdf");
	// Excluded ids rather than included, so a newly added track is selected by default.
	const [excluded, setExcluded] = useState<Set<number>>(new Set());
	const [status, setStatus] = useState("");

	const selectedIds = tracks.filter((track) => !excluded.has(track.id)).map((track) => track.id);

	const toggleTrack = (id: number) => {
		setExcluded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(buildText(selectedIds));
			setStatus("Copied");
		} catch {
			setStatus("Copy failed");
		}
		setTimeout(() => setStatus(""), 2000);
	};

	const download = () => {
		if (format === "txt") onExportText(selectedIds);
		else onExportPdf(selectedIds);
		setOpen(false);
	};

	// Same underline-tab language as the Tab/Progression switch: the chosen
	// format is the active tab, not an accent-bordered box.
	const formatButton = (value: Format, label: string) => (
		<button
			className={
				"text-xs px-3 py-1.5 border-b-2 transition-colors " +
				(format === value
					? "bg-plate-sunken border-b-accent text-ink"
					: "bg-plate-raised border-b-hairline-strong text-ink-soft hover:text-ink")
			}
			onClick={() => setFormat(value)}
		>
			{label}
		</button>
	);

	return (
		<>
			<button className="btn text-xs px-3 py-1.5" onClick={() => setOpen(true)}>
				Export
			</button>
			{open && (
				<div
					className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-5"
					onClick={() => setOpen(false)}
				>
					<div
						className="bg-plate border border-ink-faint p-6 w-full max-w-md shadow-[0_10px_28px_rgba(28,27,25,0.28)]"
						onClick={(event) => event.stopPropagation()}
					>
						<h3 className="font-display text-xl text-ink mb-4">Export</h3>

						<div className="flex flex-col border-t border-hairline mb-4">
							{tracks.map((track) => (
								<label
									key={track.id}
									className="flex items-center gap-2.5 border-b border-hairline px-1 py-2.5 cursor-pointer hover:bg-plate/60"
								>
									<input
										type="checkbox"
										className="accent-accent"
										checked={!excluded.has(track.id)}
										onChange={() => toggleTrack(track.id)}
									/>
									<span className="text-sm text-ink font-medium truncate">{track.name}</span>
								</label>
							))}
						</div>

						<div className="flex gap-1 mb-5">
							{formatButton("pdf", "PDF")}
							{formatButton("txt", "Text")}
						</div>

						<div className="flex items-center gap-2">
							<button
								className="bg-accent text-accent-ink text-xs font-medium px-2.5 py-1.5 hover:opacity-90 disabled:opacity-40"
								disabled={selectedIds.length === 0}
								onClick={download}
							>
								Download {format === "pdf" ? ".pdf" : ".txt"}
							</button>
							{format === "txt" && (
								<button
									className="btn text-xs px-2 py-1.5"
									disabled={selectedIds.length === 0}
									onClick={copy}
								>
									Copy
								</button>
							)}
							<button className="btn text-xs px-2 py-1.5" onClick={() => setOpen(false)}>
								Cancel
							</button>
							{status && <span className="text-xs text-accent">{status}</span>}
						</div>
					</div>
				</div>
			)}
		</>
	);
}
