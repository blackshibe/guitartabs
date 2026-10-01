import { useRef } from "react";
import type { Song } from "../types";
import { DownloadIcon, MoveDownIcon, MoveUpIcon, TrashIcon } from "./Icons";

interface Props {
	songs: Song[];
	currentSongId: string;
	isAutosaved: boolean;
	onLoad: (id: string) => void;
	onDelete: (id: string) => void;
	onMove: (id: string, dir: -1 | 1) => void;
	onNew: () => void;
	onSave: () => void;
	onExport: () => void;
	onExportSong: (id: string) => void;
	onImport: (file: File) => void;
}

const btn = "btn text-xs px-2 py-1.5";
const rowAction = "text-ink-faint hover:text-ink text-[13px] px-1.5 py-0.5 disabled:opacity-30";
const saveBtn = "bg-accent text-accent-ink text-xs font-medium px-2.5 py-1.5 hover:opacity-90";

export default function SongSidebar({
	songs,
	currentSongId,
	isAutosaved,
	onLoad,
	onDelete,
	onMove,
	onNew,
	onSave,
	onExport,
	onExportSong,
	onImport,
}: Props) {
	const isSaved = songs.some((s) => s.id === currentSongId);
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	const handleDelete = (song: Song) => {
		if (window.confirm(`Delete "${song.title || "Untitled Song"}"? This can't be undone.`)) {
			onDelete(song.id);
		}
	};

	return (
		<aside className="w-full md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-hairline-strong md:h-screen md:sticky md:top-0 overflow-y-auto p-5 bg-plate-raised">
			<div className="flex items-center justify-between mb-3.5">
				<h2 className="font-display font-semibold text-lg text-ink">Songs</h2>
				<button className={btn} onClick={onNew}>
					+ New
				</button>
			</div>

			<div className="flex items-center gap-2 mb-4">
				{isSaved ? (
					<span className="text-xs text-ink-faint flex-1" title="Changes save automatically">
						{isAutosaved ? "Autosaved" : "Saving…"}
					</span>
				) : (
					<button className={`${saveBtn} flex-1`} onClick={onSave}>
						Save
					</button>
				)}
			</div>

			<div className="flex items-center gap-3 mb-4 border-b border-hairline pb-3.5">
				<button className={btn} onClick={onExport} title="Download all saved songs as JSON">
					Export
				</button>
				<button
					className={btn}
					onClick={() => fileInputRef.current?.click()}
					title="Merge songs from a JSON export"
				>
					Import
				</button>

				<input
					ref={fileInputRef}
					type="file"
					accept=".tabz,.json,application/json,application/octet-stream"
					className="hidden"
					onChange={(e) => {
						const file = e.target.files?.[0];
						if (file) onImport(file);
						e.target.value = "";
					}}
				/>
			</div>

			{songs.length === 0 ? (
				<p className="text-xs text-ink-faint">Nothing saved yet — hit Save to store the current song here.</p>
			) : (
				<div className="flex flex-col">
					{songs.map((song, idx) => (
						<div
							key={song.id}
							className={
								"group border-b border-hairline px-1 py-2.5 cursor-pointer " +
								(song.id === currentSongId
									? "bg-plate border-l-2 border-l-accent pl-2"
									: "hover:bg-plate/60")
							}
							onClick={() => onLoad(song.id)}
						>
							<div className="min-w-0 text-sm text-ink truncate font-medium">
								{song.title || "Untitled Song"}
							</div>
							<div className="text-[11px] text-ink-faint mt-0.5 font-mono">
								{song.tracks.length} track{song.tracks.length === 1 ? "" : "s"} · {song.measureCount}{" "}
								measures
							</div>
							<div className="text-[11px] text-ink-faint/70">
								{new Date(song.updatedAt).toLocaleString()}
							</div>
							{/* One action bar per row — icons grouped in a fixed order
							    instead of scattered around the title line. */}
							<div className="flex items-center gap-0.5 mt-1.5 border-t border-hairline pt-1">
								<button
									className={rowAction}
									title="Export this song as JSON"
									onClick={(e) => {
										e.stopPropagation();
										onExportSong(song.id);
									}}
								>
									<DownloadIcon />
								</button>
								<button
									className={rowAction}
									title="Move up"
									disabled={idx === 0}
									onClick={(e) => {
										e.stopPropagation();
										onMove(song.id, -1);
									}}
								>
									<MoveUpIcon />
								</button>
								<button
									className={rowAction}
									title="Move down"
									disabled={idx === songs.length - 1}
									onClick={(e) => {
										e.stopPropagation();
										onMove(song.id, 1);
									}}
								>
									<MoveDownIcon />
								</button>
								<button
									className="ml-auto text-ink-faint hover:text-accent text-[13px] px-1.5 py-0.5"
									title="Delete song"
									onClick={(e) => {
										e.stopPropagation();
										handleDelete(song);
									}}
								>
									<TrashIcon />
								</button>
							</div>
						</div>
					))}
				</div>
			)}
		</aside>
	);
}
