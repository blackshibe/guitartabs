// Minimal wrapper around the YouTube IFrame Player API: one lazy script
// load, id parsing, and the anchor-measure → video-seconds conversion that
// keeps a reference video locked to the tab's own timeline.

// The API script defines window.YT at runtime; these declarations cover the
// slice of it this app uses, so no call site needs to cast `window`.
export interface YouTubePlayer {
	seekTo(seconds: number, allowSeekAhead: boolean): void;
	playVideo(): void;
	pauseVideo(): void;
	getCurrentTime(): number;
	setVolume(volume: number): void;
	destroy(): void;
}

export interface YouTubeNamespace {
	Player: new (
		element: HTMLElement,
		options: {
			videoId: string;
			width?: string;
			height?: string;
			playerVars?: Record<string, unknown>;
			events?: { onReady?: () => void };
		},
	) => YouTubePlayer;
}

declare global {
	interface Window {
		YT?: YouTubeNamespace;
		onYouTubeIframeAPIReady?: () => void;
	}
}

let apiPromise: Promise<YouTubeNamespace> | null = null;

export function loadYouTubeApi(): Promise<YouTubeNamespace> {
	if (apiPromise) return apiPromise;
	apiPromise = new Promise((resolve) => {
		if (window.YT?.Player) {
			resolve(window.YT);
			return;
		}
		const previousCallback = window.onYouTubeIframeAPIReady;
		window.onYouTubeIframeAPIReady = () => {
			previousCallback?.();
			resolve(window.YT as YouTubeNamespace);
		};
		const script = document.createElement("script");
		script.src = "https://www.youtube.com/iframe_api";
		document.head.appendChild(script);
	});
	return apiPromise;
}

const ID_PATTERNS = [/(?:v=|\/embed\/|youtu\.be\/|\/shorts\/)([A-Za-z0-9_-]{11})/, /^([A-Za-z0-9_-]{11})$/];

export function extractVideoId(input: string): string | null {
	const trimmed = input.trim();
	for (const pattern of ID_PATTERNS) {
		const matched = trimmed.match(pattern);
		if (matched) return matched[1];
	}
	return null;
}

// Video time for global column `column`, given the song's tempo and one
// anchor point (anchorMeasure's downbeat ↔ anchorSeconds). Constant tempo.
export function videoSecondsForCol(
	youtube: { anchorMeasure: number; anchorSeconds: number },
	bpm: number,
	colsPerMeasure: number,
	column: number,
): number {
	const secondsPerColumn = 60 / bpm / 2;
	const anchorColumn = youtube.anchorMeasure * colsPerMeasure;
	return Math.max(0, youtube.anchorSeconds + (column - anchorColumn) * secondsPerColumn);
}
