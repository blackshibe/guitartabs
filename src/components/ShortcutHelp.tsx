import { useState } from "react";
import { HelpIcon } from "./Icons";

const SHORTCUTS: [string, string][] = [
	["0-9", "set fret"],
	["↑ ↓", "move string"],
	["← → Tab", "move column"],
	["Shift+arrows / drag", "select range"],
	["Ctrl+C / X / V", "copy / cut / paste"],
	["Ctrl+Z / Y", "undo / redo"],
	["Delete", "clear"],
	["Space", "play / stop"],
	["Esc", "deselect"],
];

export default function ShortcutHelp() {
	const [open, setOpen] = useState(false);
	return (
		<div className="relative">
			<button className="btn text-sm px-2.5 py-1.5" onClick={() => setOpen((v) => !v)} title="Keyboard shortcuts">
				<HelpIcon />
			</button>
			{open && (
				<div className="absolute right-0 bottom-full mb-1 z-50 bg-plate border border-ink-faint p-3 w-72 shadow-[0_6px_16px_rgba(0,0,0,0.4)]">
					<div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
						{SHORTCUTS.map(([keys, what]) => (
							<div key={keys} className="contents">
								<span className="font-mono text-ink">{keys}</span>
								<span className="text-ink-soft">{what}</span>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
