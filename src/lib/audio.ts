
let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
	if (!ctx) ctx = new AudioContext();
	return ctx;
}

// Everything (synth notes, stems, backings) routes through one master gain,
// so a single slider scales the whole mix. The value survives until the
// AudioContext exists — it's applied when the node is first created.
let masterGain: GainNode | null = null;
let masterVolume = 1;

function getMasterGain(): GainNode {
	if (!masterGain) {
		const audioCtx = getCtx();
		masterGain = audioCtx.createGain();
		masterGain.gain.value = masterVolume;
		masterGain.connect(audioCtx.destination);
	}
	return masterGain;
}

export function setMasterVolume(volume: number): void {
	masterVolume = Math.max(0, Math.min(1, volume));
	if (masterGain) masterGain.gain.value = masterVolume;
}

// Plucked-string-ish tone: short decaying triangle wave.
export function playNote(freq: number, time: number, duration = 0.35, volume = 1): void {
	if (volume <= 0) return;
	const audioCtx = getCtx();
	const osc = audioCtx.createOscillator();
	const gain = audioCtx.createGain();
	osc.type = "triangle";
	osc.frequency.setValueAtTime(freq, time);
	gain.gain.setValueAtTime(0.0001, time);
	gain.gain.exponentialRampToValueAtTime(0.3 * volume, time + 0.01);
	gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
	osc.connect(gain);
	gain.connect(getMasterGain());
	osc.start(time);
	osc.stop(time + duration + 0.05);
}

// Decoded buffers cached by payload object identity — reducer edits that
// don't replace the audio keep the same object, so decoding happens once per
// upload. Shared by stems and track samples.
const audioBufferCache = new WeakMap<{ data: string }, Promise<AudioBuffer>>();

export function decodeAudio(payload: { data: string }): Promise<AudioBuffer> {
	let p = audioBufferCache.get(payload);
	if (!p) {
		const binary = atob(payload.data);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		p = getCtx().decodeAudioData(bytes.buffer);
		audioBufferCache.set(payload, p);
	}
	return p;
}

// ---- timeline-aligned audio: song-level stems and per-track backing ----

const activeStems = new Map<number, { source: AudioBufferSourceNode; gain: GainNode }>();
let stemGeneration = 0;

// Start a timeline-aligned layer (stem or track backing) at audio-clock
// `when`, `offset` seconds into the file. If decoding outlasts the start time
// it comes in late but in sync. Keyed by stem id / track id (shared nextId
// counter, so the two never collide).
export async function startStem(
	stemId: number,
	stem: { data: string },
	when: number,
	offset: number,
	volume: number,
): Promise<void> {
	const gen = stemGeneration;
	const buffer = await decodeAudio(stem);
	if (gen !== stemGeneration) return; // playback stopped while decoding
	const audioCtx = getCtx();
	const t = Math.max(when, audioCtx.currentTime);
	const off = offset + (t - when);
	if (off >= buffer.duration) return;
	const source = audioCtx.createBufferSource();
	source.buffer = buffer;
	const gain = audioCtx.createGain();
	gain.gain.value = volume;
	source.connect(gain);
	gain.connect(getMasterGain());
	source.start(t, off);
	activeStems.get(stemId)?.source.stop();
	activeStems.set(stemId, { source, gain });
	source.onended = () => {
		if (activeStems.get(stemId)?.source === source) activeStems.delete(stemId);
	};
}

export function stopStems(): void {
	stemGeneration += 1;
	activeStems.forEach(({ source }) => source.stop());
	activeStems.clear();
}

// Live mix: retarget a playing stem's gain without restarting it.
export function setStemVolume(stemId: number, volume: number): void {
	const active = activeStems.get(stemId);
	if (active) active.gain.gain.value = volume;
}

export function resumeAudio(): AudioContext {
	const audioCtx = getCtx();
	if (audioCtx.state === "suspended") audioCtx.resume();
	return audioCtx;
}

export function now(): number {
	return getCtx().currentTime;
}
