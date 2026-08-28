// Skeleton shown while the library hydrates from IndexedDB: the page's real
// structure (sidebar, title, tab strip, section plates) as pulsing ghost
// blocks, so the load reads as the app arriving rather than a blank song.
export default function GhostScreen() {
	return (
		<div className="flex flex-col md:flex-row items-start animate-pulse" aria-busy="true">
			<aside className="w-full md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-hairline-strong md:h-screen p-5 bg-plate-raised">
				<div className="h-6 w-20 bg-plate-sunken mb-5" />
				{Array.from({ length: 4 }, (_, i) => (
					<div key={i} className="border-b border-hairline py-3">
						<div className="h-3.5 w-36 bg-plate-sunken mb-2" />
						<div className="h-2.5 w-24 bg-plate-sunken/60" />
					</div>
				))}
			</aside>

			<div className="min-w-0 flex-1 max-w-[1100px] mx-auto px-5 pt-6 w-full">
				<div className="h-10 w-72 bg-plate-raised mb-6" />
				<div className="flex gap-0.5 mb-2">
					<div className="h-9 w-40 bg-plate-raised border-b-2 border-hairline-strong" />
					<div className="h-9 w-24 bg-plate-raised/50" />
				</div>
				<div className="h-3 w-56 bg-plate-raised mb-6" />
				{Array.from({ length: 2 }, (_, i) => (
					<div key={i} className="bg-plate-raised border border-hairline-strong border-l-[3px] p-4 mb-4">
						<div className="h-5 w-32 bg-plate-sunken mb-4" />
						{Array.from({ length: 6 }, (_, s) => (
							<div key={s} className="h-px bg-hairline my-4" />
						))}
					</div>
				))}
			</div>
		</div>
	);
}
