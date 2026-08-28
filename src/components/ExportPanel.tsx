import { useState } from "react";

interface Props {
	text: string;
}

export default function ExportPanel({ text }: Props) {
	const [open, setOpen] = useState(false);
	const [status, setStatus] = useState("");

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setStatus("Copied");
		} catch {
			setStatus("Copy failed");
		}
		setTimeout(() => setStatus(""), 2000);
	};

	return (
		<div className="mt-10 border-t-2 border-hairline-strong pt-3">
			<div className="flex items-center gap-3">
				<button
					className="bg-transparent text-sm font-medium text-ink-soft hover:text-ink px-0"
					onClick={() => setOpen((v) => !v)}
				>
					{open ? "▾" : "▸"} Export
				</button>
				<button className="btn text-xs px-2 py-1" onClick={copy}>
					Copy as text
				</button>
				{status && <span className="text-xs text-accent">{status}</span>}
			</div>
			{open && (
				<pre className="mt-2 bg-plate-raised border border-hairline-strong p-4 overflow-x-auto font-mono text-[13px] leading-relaxed whitespace-pre text-ink">
					{text}
				</pre>
			)}
		</div>
	);
}
