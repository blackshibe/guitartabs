interface Props {
	message: string | null;
}

export default function Toast({ message }: Props) {
	if (!message) return null;
	return (
		<div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-ink text-plate text-sm font-medium px-4 py-2.5 shadow-[0_6px_16px_rgba(0,0,0,0.4)]">
			{message}
		</div>
	);
}
