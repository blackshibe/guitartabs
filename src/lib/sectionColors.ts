// Tie colors for linked section groups — muted pencil marks etched into the
// dark plate, never as loud as the single crimson transport accent.
export const SECTION_COLORS: string[] = [
	"#c9975f", // umber
	"#8caa7e", // forest
	"#7fa8ad", // slate teal
	"#cbb15a", // ochre
	"#a486a8", // plum
	"#c07a63", // brick
];

export const NEUTRAL_TIE = "#4c4638";

export function tieColor(colorIndex: number | undefined): string {
	return colorIndex != null ? SECTION_COLORS[colorIndex % SECTION_COLORS.length] : NEUTRAL_TIE;
}
