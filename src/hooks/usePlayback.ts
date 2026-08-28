import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Playhead, Song } from "../types";
import { COLS_PER_MEASURE, stringMidi } from "../lib/instruments";
import { midiToFreq } from "../lib/tunings";
import { now, playNote, resumeAudio, startStem, stopStems } from "../lib/audio";
import { cellMidiOffset, parseCellValue } from "../lib/harmonics";
import { videoSecondsForCol } from "../lib/youtube";
import type { YoutubeSyncHandle } from "../components/YoutubeSync";

// Playback mixes every track together over the real timeline, plus the
// reference video and any timeline-aligned audio layers.
//
// A lookahead scheduler (the standard Web Audio pattern), not a naive
// setTimeout-per-note loop: notes are scheduled onto the audio clock a bit
// ahead of when they sound, so JS event-loop jitter (React renders, GC)
// never delays the audio itself — it can only delay how far ahead we
// schedule, which a 150ms lookahead window comfortably absorbs.
export function usePlayback(song: Song, youtubePlayerRef: RefObject<YoutubeSyncHandle | null>) {
	const { bpm, measureCount, tracks, stems, youtube } = song;
	const [isPlaying, setIsPlaying] = useState(false);
	const [playhead, setPlayhead] = useState<Playhead | null>(null);
	const schedulerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const visualTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

	// Always-current tracks for the scheduler's closures, so volume slides and
	// backing changes take effect mid-playback instead of freezing until the
	// next play.
	const tracksRef = useRef(tracks);
	tracksRef.current = tracks;

	const stopPlayback = useCallback(() => {
		if (schedulerTimeoutRef.current) clearTimeout(schedulerTimeoutRef.current);
		schedulerTimeoutRef.current = null;
		visualTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
		visualTimeoutsRef.current = [];
		setIsPlaying(false);
		setPlayhead(null);
		stopStems();
		youtubePlayerRef.current?.pause();
	}, [youtubePlayerRef]);

	const startPlayback = (fromStep = 0) => {
		// Restarting mid-play (scrub, click-to-jump) must kill the previous
		// scheduler first, or two tick loops would schedule on top of each other.
		if (schedulerTimeoutRef.current) clearTimeout(schedulerTimeoutRef.current);
		schedulerTimeoutRef.current = null;
		visualTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
		visualTimeoutsRef.current = [];
		stopStems();
		resumeAudio();
		setIsPlaying(true);
		const stepDuration = 60 / bpm / 2; // seconds per 8th note
		const scheduleAheadSeconds = 0.15;
		const tickIntervalMs = 25;

		const totalSteps = measureCount * COLS_PER_MEASURE;
		let nextStepIndex = Math.max(0, Math.min(fromStep, totalSteps - 1));
		let nextStepTime = now() + 0.05;

		// The video free-runs after the initial seek, so a buffering stall makes
		// it fall behind the tab clock. Re-check drift once a second against the
		// audio clock and re-seek when it exceeds the threshold.
		const videoStartSeconds = youtube ? videoSecondsForCol(youtube, bpm, COLS_PER_MEASURE, nextStepIndex) : 0;
		const playbackStartTime = nextStepTime;
		let lastDriftCheck = now();
		if (youtube) youtubePlayerRef.current?.seekAndPlay(videoStartSeconds);

		// Song-level stems and per-track backings play aligned to measure 0 at
		// song tempo, offset to wherever playback starts. A track with a backing
		// mutes its own synth notes below.
		const startOffsetSeconds = nextStepIndex * stepDuration;
		(stems ?? []).forEach((stem) => {
			startStem(stem.id, stem, playbackStartTime, startOffsetSeconds, stem.volume ?? 1);
		});
		tracks.forEach((track) => {
			if (track.backing) startStem(track.id, track.backing, playbackStartTime, startOffsetSeconds, track.volume ?? 1);
		});

		const scheduleStep = (stepIndex: number, time: number) => {
			const measure = Math.floor(stepIndex / COLS_PER_MEASURE);
			const column = stepIndex % COLS_PER_MEASURE;
			tracks.forEach((track) => {
				const cells = track.measures[measure]?.[column];
				if (!cells) return;
				const liveTrack = tracksRef.current.find((candidate) => candidate.id === track.id) ?? track;
				cells.forEach((value, stringIndex) => {
					const parsed = parseCellValue(value);
					if (!parsed) return;
					if (liveTrack.backing) return; // the backing audio is this track's sound
					const midi = stringMidi(track.tuning[stringIndex]) + cellMidiOffset(parsed);
					playNote(midiToFreq(midi), time, 0.35, liveTrack.volume ?? 1);
				});
			});
			const visualDelayMs = Math.max(0, (time - now()) * 1000);
			visualTimeoutsRef.current.push(setTimeout(() => setPlayhead({ measure, column }), visualDelayMs));
		};

		const tick = () => {
			while (nextStepIndex < totalSteps && nextStepTime < now() + scheduleAheadSeconds) {
				scheduleStep(nextStepIndex, nextStepTime);
				nextStepTime += stepDuration;
				nextStepIndex += 1;
			}
			if (youtube && now() - lastDriftCheck > 1) {
				lastDriftCheck = now();
				const actualSeconds = youtubePlayerRef.current?.getCurrentTime();
				if (actualSeconds != null) {
					const expectedSeconds = Math.max(0, videoStartSeconds + (now() - playbackStartTime));
					if (Math.abs(actualSeconds - expectedSeconds) > 0.3) youtubePlayerRef.current?.seekAndPlay(expectedSeconds);
				}
			}
			if (nextStepIndex >= totalSteps) {
				schedulerTimeoutRef.current = setTimeout(stopPlayback, Math.max(0, (nextStepTime - now()) * 1000));
				return;
			}
			schedulerTimeoutRef.current = setTimeout(tick, tickIntervalMs);
		};
		tick();
	};

	useEffect(() => stopPlayback, [stopPlayback]);

	return { isPlaying, playhead, startPlayback, stopPlayback };
}
