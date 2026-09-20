// A grid cell's stored value encodes three things at once:
//
//   "5"      plain fret
//   "<7>"    natural harmonic — the ASCII-tab convention, which also makes the
//            text export read right with zero work; drawn as "◇7" in the grid
//   "5=2"    the note rings for 2 bars (sustain)
//   "<7>=2"  both
//
// The encoding stays a plain string so every existing cell path (clipboard,
// export, storage, equality) keeps working untouched.

const CELL_PATTERN = /^(?:<(\d{1,2})>|(\d{1,2}))(?:=(\d))?$/;

/** Ring lengths the S key cycles through, in bars. */
export const RING_CYCLE = [1, 2, 4];

export interface ParsedCell {
	fret: number;
	harmonic: boolean;
	/** bars this note rings for; 0 = no sustain */
	ringBars: number;
}

/** Parse a cell value; null for empty or non-numeric garbage. */
export function parseCellValue(value: string | null): ParsedCell | null {
	if (value === null || value === "") return null;
	const match = CELL_PATTERN.exec(value);
	if (!match) {
		// Older/hand-edited values that are plain numbers but out of pattern.
		const fret = Number(value);
		return Number.isFinite(fret) ? { fret, harmonic: false, ringBars: 0 } : null;
	}
	const harmonic = match[1] !== undefined;
	return {
		fret: Number(harmonic ? match[1] : match[2]),
		harmonic,
		ringBars: match[3] ? Number(match[3]) : 0,
	};
}

/** Render a parsed cell back to its stored form. */
export function formatCell(parsed: ParsedCell): string {
	const head = parsed.harmonic ? `<${parsed.fret}>` : String(parsed.fret);
	return parsed.ringBars > 0 ? `${head}=${parsed.ringBars}` : head;
}

export function isHarmonicValue(value: string | null): boolean {
	return parseCellValue(value)?.harmonic === true;
}

/** "12" ↔ "<12>", keeping any ring length; non-numeric values pass through. */
export function toggleHarmonic(value: string): string {
	const parsed = parseCellValue(value);
	if (!parsed) return value;
	return formatCell({ ...parsed, harmonic: !parsed.harmonic });
}

/** Bars this cell's note rings for; 0 when it doesn't sustain. */
export function cellRingBars(value: string | null): number {
	return parseCellValue(value)?.ringBars ?? 0;
}

/** S cycles a note's sustain 1 → 2 → 4 → off; empty cells are left alone. */
export function cycleRing(value: string | null): string | null {
	const parsed = parseCellValue(value);
	if (!parsed) return value;
	const next = RING_CYCLE[RING_CYCLE.indexOf(parsed.ringBars) + 1] ?? 0;
	return formatCell({ ...parsed, ringBars: next });
}

/** Typing a digit into a cell, keeping its harmonic/ring flags. */
export function typeDigit(value: string | null, digit: string): string {
	const parsed = parseCellValue(value);
	if (!parsed) return digit;
	const combined = Number(String(parsed.fret) + digit);
	const fret = String(combined).length > 2 || combined > 24 ? Number(digit) : combined;
	return formatCell({ ...parsed, fret });
}

/** What the grid shows for a stored value — the ring is drawn as a rule, not text. */
export function displayCellValue(value: string): string {
	const parsed = parseCellValue(value);
	if (!parsed) return value;
	return parsed.harmonic ? `◇${parsed.fret}` : String(parsed.fret);
}

/** What ASCII export prints in the cell — the ring becomes "~" filler after it. */
export function exportCellLabel(value: string | null): string | null {
	const parsed = parseCellValue(value);
	if (!parsed) return null;
	return parsed.harmonic ? `<${parsed.fret}>` : String(parsed.fret);
}

// A natural harmonic's pitch comes from the node position, not a fretted
// stop: semitones above the OPEN string. Unlisted node frets fall back to
// the octave.
const NATURAL_HARMONIC_OFFSETS: Record<number, number> = {
	12: 12,
	7: 19,
	19: 19,
	5: 24,
	24: 24,
	4: 28,
	9: 28,
	16: 28,
};

/** Midi offset from the OPEN string for a cell (harmonics ignore the fret stop). */
export function cellMidiOffset(parsed: ParsedCell): number {
	if (!parsed.harmonic) return parsed.fret;
	return NATURAL_HARMONIC_OFFSETS[parsed.fret] ?? 12;
}
