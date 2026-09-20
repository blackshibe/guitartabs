import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Playhead, Song } from "../types";
import { COLS_PER_MEASURE, stringMidi } from "../lib/instruments";
import { midiToFreq } from "../lib/tunings";
import { now, playNote, resumeAudio, startStem, stopStems } from "../lib/audio";
import { cellMidiOffset, parseCellValue } from "../lib/cellValue";
import { locateStep, playableSteps, secondsAtStep, slotStepSeconds, type ProgressionSlot } from "../lib/progression";
import { videoSecondsForStep } from "../lib/youtube";
import type { YoutubeSyncHandle } from "../components/YoutubeSync";

// Playback mixes every track together over the arrangement — the progression's
// expanded slot list, not the raw measure timeline — plus the reference video
// and any timeline-aligned audio layers. A "step" is one column on that
// expanded timeline; `locateStep` maps it back to the source measure the cells
// actually live in.
//
// A lookahead scheduler (the standard Web Audio pattern), not a naive
// setTimeout-per-note loop: notes are scheduled onto the audio clock a bit
// ahead of when they sound, so JS event-loop jitter (React renders, GC)
// never delays the audio itself — it can only delay how far ahead we
// schedule, which a 150ms lookahead window comfortably absorbs.
export function usePlayback(
	song: Song,
	slots: ProgressionSlot[],
	youtubePlayerRef: RefObject<YoutubeSyncHandle | null>,
) {
	const { bpm, tracks, stems, youtube, leadInBars } = song;
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

	const startPlayback = (fromStep = 0, skipLeadIn = false) => {
		// Restarting mid-play (scrub, click-to-jump) must kill the previous
		// scheduler first, or two tick loops would schedule on top of each other.
		if (schedulerTimeoutRef.current) clearTimeout(schedulerTimeoutRef.current);
		schedulerTimeoutRef.current = null;
		visualTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
		visualTimeoutsRef.current = [];
		stopStems();
		resumeAudio();
		const stepDuration = 60 / bpm / 2; // seconds per 8th note at the song tempo
		const scheduleAheadSeconds = 0.15;
		const tickIntervalMs = 25;
		// Section tempo overrides make the step→seconds mapping piecewise.
		const secondsAt = (step: number) => secondsAtStep(slots, bpm, step);
		const stepSecondsFor = (stepIndex: number) => {
			const at = locateStep(slots, stepIndex);
			return at ? slotStepSeconds(at.slot, bpm) : stepDuration;
		};

		const totalSteps = playableSteps(slots);
		if (totalSteps === 0) return;
		setIsPlaying(true);
		let nextStepIndex = Math.max(0, Math.min(fromStep, totalSteps - 1));

		// Lead-in: stems/backings/video run through it while the synth waits.
		// Playing from the top rolls through it; jumping to a cell skips it.
		const leadInSeconds = (leadInBars ?? 0) * COLS_PER_MEASURE * stepDuration;
		const preRollSeconds = nextStepIndex === 0 && !skipLeadIn ? leadInSeconds : 0;
		const playbackStartTime = now() + 0.05; // when sound actually starts
		let nextStepTime = playbackStartTime + preRollSeconds;
		// Park the playhead on the first cell during the pre-roll so the wait
		// reads as counting in, not as a hang.
		if (preRollSeconds > 0) {
			const first = locateStep(slots, nextStepIndex);
			if (first) setPlayhead({ measure: first.measure, column: first.column, slot: first.slot.index });
		}

		// The video free-runs after the initial seek, so a buffering stall makes
		// it fall behind the tab clock. Re-check drift once a second against the
		// audio clock and re-seek when it exceeds the threshold.
		const videoStartSeconds = youtube
			? videoSecondsForStep(youtube, COLS_PER_MEASURE, nextStepIndex, secondsAt) - preRollSeconds
			: 0;
		let lastDriftCheck = now();
		if (youtube) {
			// A negative start means the tab's clock reaches the video's 0:00 mid
			// lead-in — hold the video and start it exactly then, instead of
			// letting the drift check fight a clamped seek every second.
			if (videoStartSeconds >= 0) youtubePlayerRef.current?.seekAndPlay(videoStartSeconds);
			else
				visualTimeoutsRef.current.push(
					setTimeout(() => youtubePlayerRef.current?.seekAndPlay(0), -videoStartSeconds * 1000),
				);
		}

		// Stems and backings align to the top of the shared clock (lead-in
		// included). A track with a backing mutes its own synth notes below.
		const startOffsetSeconds = secondsAt(nextStepIndex) + leadInSeconds - preRollSeconds;
		(stems ?? []).forEach((stem) => {
			startStem(stem.id, stem, playbackStartTime, startOffsetSeconds, stem.volume ?? 1);
		});
		tracks.forEach((track) => {
			if (track.backing) startStem(track.id, track.backing, playbackStartTime, startOffsetSeconds, track.volume ?? 1);
		});

		// A sustained note rings for its declared bars, but no further than the
		// next note on the same string — the string can only sound one pitch.
		const ringSeconds = (trackIndex: number, stringIndex: number, step: number, ringBars: number): number => {
			const maxSteps = ringBars * COLS_PER_MEASURE;
			for (let ahead = 1; ahead < maxSteps; ahead++) {
				const at = locateStep(slots, step + ahead);
				if (!at || at.slot.unused) break;
				const value = tracks[trackIndex].measures[at.measure]?.[at.column]?.[stringIndex];
				if (value !== null && value !== undefined && value !== "") return secondsAt(step + ahead) - secondsAt(step);
			}
			return secondsAt(step + maxSteps) - secondsAt(step);
		};

		const scheduleStep = (stepIndex: number, time: number) => {
			const at = locateStep(slots, stepIndex);
			if (!at) return;
			const { measure, column } = at;
			tracks.forEach((track, trackIndex) => {
				const cells = track.measures[measure]?.[column];
				if (!cells) return;
				const liveTrack = tracksRef.current.find((candidate) => candidate.id === track.id) ?? track;
				cells.forEach((value, stringIndex) => {
					const parsed = parseCellValue(value);
					if (!parsed) return;
					if (liveTrack.backing) return; // the backing audio is this track's sound
					const midi = stringMidi(track.tuning[stringIndex]) + cellMidiOffset(parsed);
					const duration =
						parsed.ringBars > 0 ? ringSeconds(trackIndex, stringIndex, stepIndex, parsed.ringBars) : 0.35;
					playNote(midiToFreq(midi), time, duration, liveTrack.volume ?? 1);
				});
			});
			const visualDelayMs = Math.max(0, (time - now()) * 1000);
			visualTimeoutsRef.current.push(
				setTimeout(() => setPlayhead({ measure, column, slot: at.slot.index }), visualDelayMs),
			);
		};

		const tick = () => {
			while (nextStepIndex < totalSteps && nextStepTime < now() + scheduleAheadSeconds) {
				scheduleStep(nextStepIndex, nextStepTime);
				nextStepTime += stepSecondsFor(nextStepIndex);
				nextStepIndex += 1;
			}
			if (youtube && now() - lastDriftCheck > 1) {
				lastDriftCheck = now();
				const actualSeconds = youtubePlayerRef.current?.getCurrentTime();
				if (actualSeconds != null) {
					const expectedSeconds = videoStartSeconds + (now() - playbackStartTime);
					if (expectedSeconds >= 0 && Math.abs(actualSeconds - expectedSeconds) > 0.3) {
						youtubePlayerRef.current?.seekAndPlay(expectedSeconds);
					}
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
