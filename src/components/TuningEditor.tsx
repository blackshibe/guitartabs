import { useEffect, useState } from "react";
import {
	NOTE_NAMES,
	TUNING_TYPES,
	midiToNoteOctave,
	noteOctaveToMidi,
	presetToTuning,
	rootsFor,
	tuningMidisFor,
	type Instrument,
	type TuningType,
} from "../lib/tunings";
import type { StringTuning } from "../types";
import { CloseIcon } from "./Icons";

interface Props {
	tuning: StringTuning[];
	trackName: string;
	onChange: (tuning: StringTuning[]) => void;
	onClose: () => void;
}

const btn = "btn text-sm px-2 py-1";
const danger = "btn btn-danger text-sm px-2 py-1";
const stepBtn = "btn text-sm font-mono px-1.5 py-0.5";
const sectionLabel = "text-[11px] uppercase tracking-wide text-ink-faint";

const MIN_MIDI = 12; // C0
const MAX_MIDI = 108; // C8

const midiOf = (s: StringTuning) => noteOctaveToMidi(s.noteIndex, s.octave);

// The (instrument, type, root) combo whose generated tuning matches the
// current strings exactly, if any — drives the highlighted chips.
function detectTuning(midis: number[]): { instrument: Instrument; type: TuningType; root: number } | null {
	for (const instrument of ["Guitar", "Bass"] as const) {
		for (const type of TUNING_TYPES[instrument]) {
			for (const root of rootsFor(type)) {
				const m = tuningMidisFor(instrument, type, root);
				if (m.length === midis.length && m.every((v, i) => v === midis[i])) return { instrument, type, root };
			}
		}
	}
	return null;
}

export default function TuningEditor({ tuning, trackName, onChange, onClose }: Props) {
	const currentMidis = tuning.map(midiOf);
	const match = detectTuning(currentMidis);
	const [instrument, setInstrument] = useState<Instrument>(match?.instrument ?? "Guitar");
	const [type, setType] = useState<TuningType>(match?.type ?? "Standard");
	const activeRoot = match && match.instrument === instrument && match.type === type ? match.root : null;

	useEffect(() => {
		const onKey = (e: globalThis.KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	const stepString = (i: number, delta: number) => {
		const midi = midiOf(tuning[i]) + delta;
		if (midi < MIN_MIDI || midi > MAX_MIDI) return;
		onChange(tuning.map((s, idx) => (idx === i ? midiToNoteOctave(midi) : s)));
	};

	// Whole-tuning transpose (half-step-down in one click) — no-op instead of
	// clamping so string intervals never get squashed at the range edge.
	const stepAll = (delta: number) => {
		const midis = tuning.map((s) => midiOf(s) + delta);
		if (midis.some((m) => m < MIN_MIDI || m > MAX_MIDI)) return;
		onChange(midis.map(midiToNoteOctave));
	};

	const addString = (position: number) => {
		const copy = tuning[Math.max(0, position - 1)] || { noteIndex: 4, octave: 4 };
		const next = tuning.slice();
		next.splice(position, 0, { noteIndex: copy.noteIndex, octave: copy.octave });
		onChange(next);
	};

	const removeString = (i: number) => {
		if (tuning.length <= 1) return;
		onChange(tuning.filter((_, idx) => idx !== i));
	};

	const moveString = (i: number, dir: number) => {
		const j = i + dir;
		if (j < 0 || j >= tuning.length) return;
		const next = tuning.slice();
		[next[i], next[j]] = [next[j], next[i]];
		onChange(next);
	};

	const reverseOrder = () => onChange(tuning.slice().reverse());

	// Two distinct chip states: crimson only when this choice is part of the
	// combo that actually generates the current strings; a neutral ink
	// emphasis for the combo merely being browsed (custom tunings match
	// nothing, so nothing shows crimson then).
	const chip = (selected: boolean, current: boolean) =>
		"text-[13px] px-2.5 py-1 border bg-plate-sunken transition-colors " +
		(current
			? "border-accent text-ink"
			: selected
				? "border-ink-faint text-ink"
				: "border-hairline-strong text-ink-soft hover:text-ink hover:border-ink-faint");

	return (
		<div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-5" onClick={onClose}>
			<div
				className="bg-plate border border-ink-faint p-6 w-full max-w-md max-h-[85vh] overflow-y-auto shadow-[0_10px_28px_rgba(28,27,25,0.28)]"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between mb-4">
					<h3 className="font-display text-xl text-ink">Tuning — {trackName}</h3>
					<button className={danger} onClick={onClose}>
						Close
					</button>
				</div>

				<div className={`${sectionLabel} mb-1`}>Tuning</div>
				<div className="flex flex-col gap-1 border-t border-hairline pt-2 mb-5">
					<div className="flex gap-0.5">
						{(["Guitar", "Bass"] as const).map((inst) => (
							<button
								key={inst}
								className={chip(instrument === inst, match?.instrument === inst)}
								onClick={() => {
									setInstrument(inst);
									if (!TUNING_TYPES[inst].includes(type)) setType("Standard");
								}}
							>
								{inst}
							</button>
						))}
					</div>
					<div className="flex gap-0.5">
						{TUNING_TYPES[instrument].map((t) => (
							<button
								key={t}
								className={chip(type === t, match?.instrument === instrument && match?.type === t)}
								onClick={() => setType(t)}
							>
								{t}
							</button>
						))}
					</div>
					<div className="flex flex-wrap gap-0.5">
						{rootsFor(type).map((root) => (
							<button
								key={root}
								className={"font-mono " + chip(false, activeRoot === root)}
								onClick={() => onChange(presetToTuning(tuningMidisFor(instrument, type, root)))}
							>
								{NOTE_NAMES[root]}
							</button>
						))}
					</div>
				</div>

				<div className="flex items-center justify-between mb-1">
					<span className={sectionLabel}>Strings</span>
					<span className={`flex items-center gap-0.5 ${sectionLabel}`}>
						transpose
						<button className={stepBtn} onClick={() => stepAll(-1)}>
							−
						</button>
						<button className={stepBtn} onClick={() => stepAll(1)}>
							+
						</button>
					</span>
				</div>
				<div className="flex flex-col border-t border-hairline">
					{tuning.map((s, i) => (
						<div className="flex items-center gap-1 px-1 py-1 border-b border-hairline" key={i}>
							<span className="w-12 shrink-0 text-[11px] uppercase tracking-wide text-ink-faint font-mono">
								{i === 0 ? "top" : i === tuning.length - 1 ? "bottom" : i + 1}
							</span>
							<button
								className={stepBtn}
								title="Semitone down"
								onClick={() => stepString(i, -1)}
								disabled={midiOf(s) <= MIN_MIDI}
							>
								−
							</button>
							<span className="w-10 text-center font-mono text-sm text-ink">
								{NOTE_NAMES[s.noteIndex]}
								{s.octave}
							</span>
							<button
								className={stepBtn}
								title="Semitone up"
								onClick={() => stepString(i, 1)}
								disabled={midiOf(s) >= MAX_MIDI}
							>
								+
							</button>
							<span className="flex-1" />
							<button
								className={btn}
								title="Move up"
								onClick={() => moveString(i, -1)}
								disabled={i === 0}
							>
								↑
							</button>
							<button
								className={btn}
								title="Move down"
								onClick={() => moveString(i, 1)}
								disabled={i === tuning.length - 1}
							>
								↓
							</button>
							<button className={btn} title="Insert string below" onClick={() => addString(i + 1)}>
								+
							</button>
							<button
								className={danger}
								title="Remove string"
								onClick={() => removeString(i)}
								disabled={tuning.length <= 1}
							>
								<CloseIcon />
							</button>
						</div>
					))}
				</div>

				<div className="flex gap-2 mt-4">
					<button className={btn} onClick={() => addString(tuning.length)}>
						+ Add string
					</button>
					<button className={btn} onClick={reverseOrder}>
						Reverse order
					</button>
				</div>
			</div>
		</div>
	);
}
