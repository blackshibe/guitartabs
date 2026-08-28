import { SHORTCUTS } from "../lib/shortcuts";

interface Props {
	onDismiss: () => void;
}

// First-run introduction: what this is, the honesty clause, and the keys.
export default function WelcomeDialog({ onDismiss }: Props) {
	return (
		<div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-5" onClick={onDismiss}>
			<div
				className="bg-plate border border-ink-faint p-6 w-full max-w-md max-h-[85vh] overflow-y-auto shadow-[0_10px_28px_rgba(28,27,25,0.28)]"
				onClick={(event) => event.stopPropagation()}
			>
				<h3 className="font-display font-semibold text-xl text-ink mb-3">Guitar Tab Editor</h3>
				<p className="text-[13px] text-ink-faint mb-2">
					A keyboard-driven tab editor. Click a cell, type fret numbers, hit Space to hear it. Songs, stems,
					and reference videos all live in your browser.
				</p>
				<p className="text-[13px] text-ink-faint mb-4">
					Might have bugs. Lots of them actually. Export songs you care about (the ⤓ on a song in the sidebar)
					- clearing browser data clears the library.
				</p>
				<p className="text-[13px] text-ink-faint mb-4">
					Disclaimer: 100% Vibecoded. Use other software if you care about that.
				</p>
				<div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1">Controls</div>
				<div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs border-t border-hairline pt-2 mb-5">
					{SHORTCUTS.map(([keys, what]) => (
						<div key={keys} className="contents">
							<span className="font-mono text-ink">{keys}</span>
							<span className="text-ink-soft">{what}</span>
						</div>
					))}
				</div>

				<button
					className="bg-accent text-accent-ink text-[13px] font-medium px-6 py-2 hover:opacity-90"
					onClick={onDismiss}
				>
					Start tabbing
				</button>
			</div>
		</div>
	);
}
