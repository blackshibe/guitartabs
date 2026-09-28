import type { Stroke, Strum } from "../types";

// A column's strum mark is a short string of strokes — "d" down, "u" up —
// that split the column's duration evenly: "d" is one strum, "du" two 16ths,
// "dudu" four 32nds. Kept a plain string so equality, copying and storage need
// nothing special.

export const MAX_STROKES = 4;

export function strokesOf(strum: Strum | null): Stroke[] {
	return strum ? (strum.split("").filter((ch) => ch === "d" || ch === "u") as Stroke[]) : [];
}

/** D / U keep adding strokes to a column; past the limit it starts over. */
export function addStroke(current: Strum | null, stroke: Stroke): Strum {
	return current && current.length < MAX_STROKES ? current + stroke : stroke;
}

export function strumArrows(strum: Strum | null): string {
	return strokesOf(strum)
		.map((stroke) => (stroke === "d" ? "↓" : "↑"))
		.join("");
}

/** Text-export label: "D", "DU", … */
export function strumLetters(strum: Strum | null): string {
	return strokesOf(strum).join("").toUpperCase();
}

/** Stored value → valid pattern or null; the first shape stored "down" / "up". */
export function normalizeStrum(value: unknown): Strum | null {
	if (value === "down") return "d";
	if (value === "up") return "u";
	return typeof value === "string" && /^[du]{1,4}$/.test(value) ? value : null;
}
