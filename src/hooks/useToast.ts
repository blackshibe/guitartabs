import { useCallback, useRef, useState } from "react";

// One transient message at a time, self-dismissing.
export function useToast() {
	const [toastMessage, setToastMessage] = useState<string | null>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const showToast = useCallback((message: string) => {
		setToastMessage(message);
		if (timerRef.current) clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => setToastMessage(null), 2200);
	}, []);

	return { toastMessage, showToast };
}
