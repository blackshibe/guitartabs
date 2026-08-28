// Harmonic cells: stored as "<7>" (the ASCII-tab convention, which also makes
// the text export read right with zero work), displayed in the grid as "◇7"
// (the diamond notehead borrowed from engraved notation).

const HARMONIC_PATTERN = /^<(\d{1,2})>$/;

export interface ParsedCell {
	fret: number;
	harmonic: boolean;
}

/** Parse a cell value; null for empty or non-numeric garbage. */
export function parseCellValue(value: string | null): ParsedCell | null {
	if (value === null || value === "") return null;
	const harmonic = HARMONIC_PATTERN.exec(value);
	if (harmonic) return { fret: Number(harmonic[1]), harmonic: true };
	const fret = Number(value);
	return Number.isFinite(fret) ? { fret, harmonic: false } : null;
}

export function isHarmonicValue(value: string | null): boolean {
	return value !== null && HARMONIC_PATTERN.test(value);
}

/** "12" ↔ "<12>"; non-numeric values pass through untouched. */
export function toggleHarmonic(value: string): string {
	const parsed = parseCellValue(value);
	if (!parsed) return value;
	return parsed.harmonic ? String(parsed.fret) : `<${parsed.fret}>`;
}

/** What the grid shows for a stored value. */
export function displayCellValue(value: string): string {
	const parsed = parseCellValue(value);
	return parsed?.harmonic ? `◇${parsed.fret}` : value;
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
