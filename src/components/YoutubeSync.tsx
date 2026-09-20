import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { SongStem, Track, YoutubeSync } from "../types";
import { extractVideoId, loadYouTubeApi, type YouTubePlayer } from "../lib/youtube";
import { setMasterVolume } from "../lib/audio";
import { BackIcon, CloseIcon, ExpandIcon, ShrinkIcon, UploadIcon } from "./Icons";

interface Props {
	youtube: YoutubeSync | undefined;
	anchorMeasure: number;
	tracks: Track[];
	stems: SongStem[];
	onSetVideo: (videoId: string | null) => void;
	onSetAnchor: (measure: number, seconds: number) => void;
	onSetTrackVolume: (id: number, volume: number) => void;
	onSetTrackBacking: (id: number, file: File | null) => void;
	onAddStem: (file: File) => void;
	onRemoveStem: (id: number) => void;
	onSetStemVolume: (id: number, volume: number) => void;
}

export interface YoutubeSyncHandle {
	seekAndPlay: (seconds: number) => void;
	pause: () => void;
	getCurrentTime: () => number | null;
}

const VIDEO_VOLUME_KEY = "tab-editor:yt-volume";
const MASTER_VOLUME_KEY = "tab-editor:master-volume";

// mm:ss.mmm for the sync readout.
function formatVideoTime(totalSeconds: number): string {
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds - minutes * 60;
	return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}

// Sliders hold a 0–100 position; the applied gain follows a cubic taper so
// the travel feels logarithmic — linear amplitude puts all the audible change
// in the top fifth of the track.
function sliderToGain(position: number): number {
	return (position / 100) ** 3;
}

function gainToSlider(gain: number): number {
	return Math.round(Math.cbrt(gain) * 100);
}

function readStoredVolume(key: string): number {
	const raw = localStorage.getItem(key);
	const value = raw == null ? NaN : Number(raw);
	return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 100;
}

// The sound panel: one floating widget pinned above the transport bar that
// owns everything the tab plays against — the reference video and each
// track's stem + mix volume.
const YoutubeSyncPanel = forwardRef<YoutubeSyncHandle, Props>(function YoutubeSyncPanel(
	{
		youtube,
		anchorMeasure,
		tracks,
		stems,
		onSetVideo,
		onSetAnchor,
		onSetTrackVolume,
		onSetTrackBacking,
		onAddStem,
		onRemoveStem,
		onSetStemVolume,
	},
	ref,
) {
	const [collapsed, setCollapsed] = useState(false);
	const [large, setLarge] = useState(false);
	const [addingSource, setAddingSource] = useState(false);
	const [addingUrl, setAddingUrl] = useState(false);
	const [urlInput, setUrlInput] = useState("");
	const [status, setStatus] = useState("");
	const mountRef = useRef<HTMLDivElement | null>(null);
	const playerRef = useRef<YouTubePlayer | null>(null);
	const [ready, setReady] = useState(false);
	const stemInputRef = useRef<HTMLInputElement | null>(null);
	const backingInputRef = useRef<HTMLInputElement | null>(null);
	const backingForTrackRef = useRef<number | null>(null);
	const [videoVolume, setVideoVolume] = useState<number>(() => readStoredVolume(VIDEO_VOLUME_KEY));
	const [masterVolume, setMasterVolumeState] = useState<number>(() => readStoredVolume(MASTER_VOLUME_KEY));

	// The onReady callback closes over the first render — read volume via ref.
	const videoVolumeRef = useRef(videoVolume);
	videoVolumeRef.current = videoVolume;

	const applyVideoVolume = (value: number) => {
		setVideoVolume(value);
		localStorage.setItem(VIDEO_VOLUME_KEY, String(value));
		playerRef.current?.setVolume(sliderToGain(value) * 100);
	};

	const applyMasterVolume = (value: number) => {
		setMasterVolumeState(value);
		localStorage.setItem(MASTER_VOLUME_KEY, String(value));
		setMasterVolume(sliderToGain(value));
	};

	useEffect(() => {
		setMasterVolume(sliderToGain(readStoredVolume(MASTER_VOLUME_KEY)));
	}, []);

	useEffect(() => {
		if (!youtube || collapsed) return;
		let cancelled = false;
		loadYouTubeApi().then((youTube) => {
			if (cancelled || !mountRef.current) return;
			playerRef.current?.destroy();
			setReady(false);
			// 100% width/height so the iframe fills the widget at any size —
			// without it the API mints a fixed 640×360 iframe.
			playerRef.current = new youTube.Player(mountRef.current, {
				videoId: youtube.videoId,
				width: "100%",
				height: "100%",
				playerVars: { playsinline: 1 },
				events: {
					onReady: () => {
						playerRef.current?.setVolume(sliderToGain(videoVolumeRef.current) * 100);
						setReady(true);
					},
				},
			});
		});
		return () => {
			cancelled = true;
			playerRef.current?.destroy();
			playerRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [youtube?.videoId, collapsed]);

	useImperativeHandle(ref, () => ({
		seekAndPlay: (seconds: number) => {
			if (!playerRef.current) return;
			playerRef.current.seekTo(seconds, true);
			playerRef.current.playVideo();
		},
		pause: () => playerRef.current?.pauseVideo(),
		getCurrentTime: () => playerRef.current?.getCurrentTime() ?? null,
	}));

	const flash = (msg: string) => {
		setStatus(msg);
		setTimeout(() => setStatus(""), 2000);
	};

	const attach = () => {
		const id = extractVideoId(urlInput);
		if (!id) {
			flash("Not a YouTube URL");
			return;
		}
		onSetVideo(id);
		setUrlInput("");
		setAddingUrl(false);
		setCollapsed(false);
	};

	const syncHere = () => {
		const t = playerRef.current?.getCurrentTime();
		if (t == null) {
			flash("Video not ready");
			return;
		}
		onSetAnchor(anchorMeasure, t);
		flash(`Anchored → #${anchorMeasure + 1}`);
	};

	// Below md there's no room for a fixed corner widget above the transport
	// bar — drop out of fixed mode there and flow inline instead.
	return (
		<div
			data-keep-selection
			className={`${large && youtube ? "w-[640px]" : "w-96"} max-w-[calc(100vw-2.5rem)] ml-auto mr-5 my-3 md:m-0 md:fixed md:bottom-16 md:right-4 md:z-40 bg-plate-raised border border-hairline-strong shadow-[0_10px_24px_rgba(0,0,0,0.45)]`}
		>
			{/* Title bar: one tonal step up (sunken plate) and taller than the
			    track/stem rows below it, so it reads as chrome, not a row. */}
			<div className="flex items-center gap-1.5 px-2 py-2.5 bg-plate-sunken border-b border-hairline-strong">
				<button
					className="text-ink-soft hover:text-ink text-[11px] font-medium uppercase tracking-wide flex-1 text-left truncate"
					onClick={() => setCollapsed((v) => !v)}
				>
					{collapsed ? "▸" : "▾"} Sound
				</button>
				<input
					type="range"
					min={0}
					max={100}
					value={masterVolume}
					title={`Master volume ${masterVolume}`}
					className="w-24 accent-accent"
					onChange={(event) => applyMasterVolume(Number(event.target.value))}
				/>
				{!collapsed && youtube && (
					<button
						className="text-ink-soft hover:text-ink text-[13px] px-1"
						onClick={() => setLarge((v) => !v)}
						title={large ? "Smaller" : "Larger"}
					>
						{large ? <ShrinkIcon /> : <ExpandIcon />}
					</button>
				)}
			</div>

			{!collapsed && (
				<>
					{youtube ? (
						<>
							<div className="aspect-video bg-plate">
								<div ref={mountRef} className="w-full h-full" />
							</div>
							<div className="flex items-center gap-2 px-2 py-1.5 border-b border-hairline">
								<button className="btn text-[11px] px-2 py-1" onClick={syncHere} disabled={!ready}>
									Sync here → #{anchorMeasure + 1}
								</button>
								{status && <span className="text-[11px] text-accent">{status}</span>}
								<input
									type="range"
									min={0}
									max={100}
									value={videoVolume}
									title={`Video volume ${videoVolume}`}
									className="ml-auto w-24 accent-accent"
									onChange={(event) => applyVideoVolume(Number(event.target.value))}
								/>
								<button
									className="text-ink-soft hover:text-accent text-[13px] px-1"
									onClick={() => onSetVideo(null)}
									title="Remove video"
								>
									<CloseIcon />
								</button>
							</div>
								{/* Sync readout + fine-tune: the anchor is the whole sync
								    model, so show it and let it be nudged in 50ms steps. */}
								<div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-hairline text-[11px] font-mono">
									<span className="text-ink-faint uppercase tracking-wide flex-1 truncate">
										sync · #{youtube.anchorMeasure + 1} ↔ {formatVideoTime(youtube.anchorSeconds)}
									</span>
									<button
										className="btn text-[11px] px-1.5 py-0.5 font-mono"
										title="Nudge video 50ms earlier relative to the tab"
										onClick={() => onSetAnchor(youtube.anchorMeasure, Math.max(0, youtube.anchorSeconds - 0.05))}
									>
										−50ms
									</button>
									<button
										className="btn text-[11px] px-1.5 py-0.5 font-mono"
										title="Nudge video 50ms later relative to the tab"
										onClick={() => onSetAnchor(youtube.anchorMeasure, youtube.anchorSeconds + 0.05)}
									>
										+50ms
									</button>
								</div>
						</>
					) : null}

					<div className="flex flex-col">
						{tracks.map((t) => (
							<div
								key={t.id}
								className="flex items-center gap-2 px-2 py-1.5 border-b border-hairline text-[11px] font-mono"
							>
								<span className="text-ink-soft truncate flex-1 min-w-0">{t.name}</span>
								{t.backing ? (
									<>
										<span
											className="truncate max-w-28 text-ink-faint shrink-0"
											title={t.backing.name}
										>
											♫ {t.backing.name}
										</span>
										<button
											className="text-ink-soft hover:text-accent px-1 shrink-0"
											title="Remove backing (back to synth)"
											onClick={() => onSetTrackBacking(t.id, null)}
										>
											<CloseIcon />
										</button>
									</>
								) : (
									<button
										className="flex items-center gap-1 text-ink-faint hover:text-ink uppercase shrink-0"
										title="Upload this track's recorded part (.ogg / .mp3) — plays from measure 1 instead of the synth"
										onClick={() => {
											backingForTrackRef.current = t.id;
											backingInputRef.current?.click();
										}}
									>
										<UploadIcon /> upload audio
									</button>
								)}
								<input
									type="range"
									min={0}
									max={100}
									value={gainToSlider(t.volume ?? 1)}
									title={`Volume ${gainToSlider(t.volume ?? 1)}`}
									className="w-24 accent-accent shrink-0"
									onChange={(e) => onSetTrackVolume(t.id, sliderToGain(Number(e.target.value)))}
								/>
							</div>
						))}
						{stems.map((s) => (
							<div
								key={s.id}
								className="flex items-center gap-2 px-2 py-1.5 border-b border-hairline text-[11px] font-mono"
							>
								<span className="text-ink-faint truncate flex-1 min-w-0" title={s.name}>
									♫ {s.name}
								</span>
								<input
									type="range"
									min={0}
									max={100}
									value={gainToSlider(s.volume ?? 1)}
									title={`Volume ${gainToSlider(s.volume ?? 1)}`}
									className="w-24 accent-accent shrink-0"
									onChange={(e) => onSetStemVolume(s.id, sliderToGain(Number(e.target.value)))}
								/>
								<button
									className="text-ink-soft hover:text-accent px-1"
									title="Remove stem"
									onClick={() => onRemoveStem(s.id)}
								>
									<CloseIcon />
								</button>
							</div>
						))}
					</div>
					<div className="flex items-center gap-2 px-2 py-2">
						{addingUrl ? (
							<>
								<input
									autoFocus
									className="bg-transparent border-b border-hairline-strong focus:border-accent outline-none text-ink text-xs font-mono px-1 py-0.5 flex-1 min-w-0"
									placeholder="Paste YouTube URL"
									value={urlInput}
									onChange={(event) => setUrlInput(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter") attach();
										if (event.key === "Escape") {
											setAddingUrl(false);
											setAddingSource(true);
										}
									}}
								/>
								<button className="btn text-xs px-2 py-1" onClick={attach}>
									Attach
								</button>
								<button
									className="text-ink-soft hover:text-ink text-[13px] px-1"
									title="Back"
									onClick={() => {
										setAddingUrl(false);
										setAddingSource(true);
									}}
								>
									<BackIcon />
								</button>
							</>
						) : addingSource ? (
							<>
								{!youtube && (
									<button
										className="btn text-[11px] px-2 py-1"
										onClick={() => {
											setAddingSource(false);
											setAddingUrl(true);
										}}
									>
										YouTube video
									</button>
								)}
								<button
									className="btn text-[11px] px-2 py-1"
									title="An audio layer (.ogg / .mp3) — plays from measure 1 alongside the tab"
									onClick={() => {
										setAddingSource(false);
										stemInputRef.current?.click();
									}}
								>
									MP3 / OGG file
								</button>
								<button
									className="text-ink-soft hover:text-ink text-[13px] px-1"
									title="Cancel"
									onClick={() => setAddingSource(false)}
								>
									<CloseIcon />
								</button>
							</>
						) : (
							<button
								className="btn text-[11px] font-mono uppercase px-2 py-1 flex items-center gap-1.5"
								onClick={() => setAddingSource(true)}
							>
								<UploadIcon /> Add source
							</button>
						)}
						{status && <span className="text-[11px] text-accent">{status}</span>}
					</div>
					<input
						ref={stemInputRef}
						type="file"
						accept=".ogg,.mp3,audio/ogg,audio/mpeg"
						className="hidden"
						onChange={(e) => {
							const file = e.target.files?.[0];
							if (file) onAddStem(file);
							e.target.value = "";
						}}
					/>
					<input
						ref={backingInputRef}
						type="file"
						accept=".ogg,.mp3,audio/ogg,audio/mpeg"
						className="hidden"
						onChange={(e) => {
							const file = e.target.files?.[0];
							if (file && backingForTrackRef.current != null)
								onSetTrackBacking(backingForTrackRef.current, file);
							backingForTrackRef.current = null;
							e.target.value = "";
						}}
					/>
				</>
			)}
		</div>
	);
});

export default YoutubeSyncPanel;
