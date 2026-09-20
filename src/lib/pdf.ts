// Sheet-style PDF export of one track, drawn with jsPDF the way real tab
// exports look: one continuous flow of measures packed line after line
// (section boundaries don't break the line), section names riding above the
// staff where they start, repeats as dotted repeat barlines with ×N, a
// stacked TAB clef and tuning letters on every line, a thin let-ring line
// over the bars a sustained note keeps sounding. The measure content comes
// from the same folded arrangement the text export walks (trackSheetSections).

import { jsPDF } from "jspdf";
import type { Song, Track } from "../types";
import { COLS_PER_MEASURE, MEASURES_PER_LINE, stringMidi, tuningLabel } from "./instruments";
import { midiToNoteName } from "./tunings";
import { exportCellLabel } from "./cellValue";
import { ringFill, trackSheetSections } from "./exportText";

const MARGIN = 48;
const STRING_GAP = 9; // between staff lines
const FRET_SIZE = 7;
const STAFF_INDENT = 20; // room for the tuning letters
const TAB_CLEF_WIDTH = 16; // room for the stacked TAB letters at line start
const LINE_HEAD = 20; // band above each line for section names, ×N, measure numbers
const LINE_GAP = 12; // between systems
const FOOTER_SPACE = 26;

// Grayscale ink levels (0 black – 255 white).
const SOFT = 100;
const STAFF = 140;
const BAR = 60;

// The standard fonts are WinAnsi; anything outside becomes "?" so jsPDF never
// prints garbage bytes.
function sanitize(text: string): string {
	let out = "";
	for (const ch of text) {
		const code = ch.codePointAt(0) ?? 63;
		out += code > 255 || (code >= 127 && code < 160) ? "?" : ch;
	}
	return out;
}

/** One measure on the printed timeline, with the marks that land on it. */
interface PrintedMeasure {
	measureIndex: number;
	/** the owning block's ring map and this measure's column offset into it */
	fill: boolean[][];
	fillPosition: number;
	/** section name, on the block's first measure */
	label?: string;
	/** section/track comments, on the block's first measure */
	comment?: string;
	beginRepeat: boolean;
	/** repeat count to print over the end-repeat bar; 0 = no end repeat */
	endRepeat: number;
	/** thin+thick final barline: the piece ends here */
	final: boolean;
}

function printedMeasures(song: Song, track: Track): PrintedMeasure[] {
	const blocks = trackSheetSections(song, track);
	const out: PrintedMeasure[] = [];
	blocks.forEach((block, blockIndex) => {
		const fill = ringFill(track, block.measureIndices);
		block.measureIndices.forEach((measureIndex, offset) => {
			const last = offset === block.measureIndices.length - 1;
			out.push({
				measureIndex,
				fill,
				fillPosition: offset * COLS_PER_MEASURE,
				label: offset === 0 && block.name ? block.name : undefined,
				comment: offset === 0 && block.comments.length > 0 ? block.comments.join(" · ") : undefined,
				beginRepeat: offset === 0 && block.repeats > 1,
				endRepeat: last && block.repeats > 1 ? block.repeats : 0,
				final: last && blockIndex === blocks.length - 1,
			});
		});
	});
	return out;
}

/** Render one track of a song as a sheet-style tab PDF. */
export function buildTrackPdf(song: Song, trackId: number): Uint8Array {
	const doc = new jsPDF({ unit: "pt", format: "a4" });
	const track = song.tracks.find((candidate) => candidate.id === trackId);
	if (!track) return new Uint8Array(doc.output("arraybuffer"));

	const pageWidth = doc.internal.pageSize.getWidth();
	const pageHeight = doc.internal.pageSize.getHeight();
	const staffX = MARGIN + STAFF_INDENT;
	const notesX = staffX + TAB_CLEF_WIDTH;
	const measureWidth = (pageWidth - MARGIN - notesX) / MEASURES_PER_LINE;
	const columnWidth = measureWidth / COLS_PER_MEASURE;
	const staffHeight = (track.tuning.length - 1) * STRING_GAP;

	const text = (value: string, x: number, y: number) => doc.text(sanitize(value), x, y);
	const setFont = (style: "normal" | "bold" | "italic", size: number, gray = 0) => {
		doc.setFont("helvetica", style);
		doc.setFontSize(size);
		doc.setTextColor(gray, gray, gray);
	};
	const bar = (x: number, top: number, thickness: number) => {
		doc.setDrawColor(BAR);
		doc.setLineWidth(thickness);
		doc.line(x, top, x, top + staffHeight);
	};
	const repeatDots = (x: number, top: number) => {
		doc.setFillColor(BAR, BAR, BAR);
		const midY = top + staffHeight / 2;
		doc.circle(x, midY - 2.4, 1.1, "F");
		doc.circle(x, midY + 2.4, 1.1, "F");
	};

	// Title block.
	setFont("bold", 18);
	const title = sanitize(song.title || "Untitled");
	text(title, (pageWidth - doc.getTextWidth(title)) / 2, MARGIN + 14);
	setFont("normal", 9, SOFT);
	const subtitle = sanitize(`${track.name} · ${tuningLabel(track.tuning)} · ${song.bpm} BPM`);
	text(subtitle, (pageWidth - doc.getTextWidth(subtitle)) / 2, MARGIN + 30);
	let y = MARGIN + 48;

	const entries = printedMeasures(song, track);
	let printedCount = 0;
	while (printedCount < entries.length) {
		const line = entries.slice(printedCount, printedCount + MEASURES_PER_LINE);
		// A line only needs the full head band when something rides above the
		// staff (section name, ×N); plain continuation lines stay tight.
		const lineHead = line.some((entry) => entry.label || entry.comment || entry.endRepeat > 0) ? LINE_HEAD : 8;
		if (y + lineHead + staffHeight > pageHeight - MARGIN - FOOTER_SPACE) {
			doc.addPage();
			y = MARGIN;
		}
		const staffTop = y + lineHead;
		const staffRight = notesX + line.length * measureWidth;
		const stringY = (stringIndex: number) => staffTop + stringIndex * STRING_GAP;
		const midY = staffTop + staffHeight / 2;

		// Staff lines; tuning letters only open the piece, like the clef.
		track.tuning.forEach((str, stringIndex) => {
			const lineY = stringY(stringIndex);
			if (printedCount === 0) {
				setFont("normal", 6, STAFF);
				text(midiToNoteName(stringMidi(str)), MARGIN, lineY + 2);
			}
			doc.setDrawColor(STAFF);
			doc.setLineWidth(0.5);
			doc.line(staffX, lineY, staffRight, lineY);
		});
		// System-start barline; the TAB clef only opens the piece — every
		// following line keeps just the lead-in so the measures stay aligned.
		bar(staffX, staffTop, 0.9);
		if (printedCount === 0) {
			const clefSize = Math.min(12, Math.max(5, staffHeight * 0.42));
			setFont("bold", clefSize, BAR);
			["T", "A", "B"].forEach((letter, index) => {
				text(letter, staffX + (TAB_CLEF_WIDTH - doc.getTextWidth(letter)) / 2 + 1, midY + (-0.56 + 0.92 * index) * clefSize + clefSize * 0.36);
			});
		}
		// Running measure number at the line start.
		if (printedCount > 0) {
			setFont("normal", 6.5, SOFT);
			text(String(printedCount + 1), MARGIN, staffTop - 5);
		}

		line.forEach((entry, slot) => {
			const left = notesX + slot * measureWidth;
			const right = left + measureWidth;
			// Section name (and its comments) above the measure it starts on —
			// a nameless section still gets its comment printed.
			if (entry.label || entry.comment) {
				// Clear of the ×N a preceding end-repeat may have put at this barline.
				const labelX = left + (slot > 0 || entry.beginRepeat ? 10 : 1.5);
				let commentX = labelX;
				if (entry.label) {
					setFont("bold", 8.5);
					text(entry.label, labelX, staffTop - 5);
					commentX += doc.getTextWidth(sanitize(entry.label)) + 6;
				}
				if (entry.comment) {
					setFont("italic", 7, SOFT);
					text(entry.comment, commentX, staffTop - 5);
				}
			}

			const measure = track.measures[entry.measureIndex] ?? [];
			measure.forEach((column, columnIndex) => {
				const position = entry.fillPosition + columnIndex;
				const cellLeft = left + columnIndex * columnWidth;
				// Edge columns of a repeated measure lean inward so their fret
				// numbers (and knockout rects) clear the repeat dots at the barline.
				let centerX = cellLeft + columnWidth / 2;
				if (entry.beginRepeat && columnIndex === 0) centerX += 4.5;
				if (entry.endRepeat > 0 && columnIndex === measure.length - 1) centerX -= 4.5;
				column.forEach((value, stringIndex) => {
					const lineY = stringY(stringIndex);
					// Ring continuation: a thin line just above the string.
					doc.setDrawColor(STAFF);
					doc.setLineWidth(0.5);
					if (entry.fill[stringIndex]?.[position]) {
						doc.line(cellLeft, lineY - 2.6, cellLeft + columnWidth, lineY - 2.6);
					}
					const label = exportCellLabel(value);
					if (label === null) return;
					setFont("normal", FRET_SIZE);
					const width = doc.getTextWidth(label);
					doc.setFillColor(255, 255, 255);
					doc.rect(centerX - width / 2 - 1.2, lineY - 3.4, width + 2.4, 6.8, "F");
					text(label, centerX - width / 2, lineY + 2.4);
					// A sustained note starts its ring line right after the number.
					if (entry.fill[stringIndex]?.[position + 1]) {
						doc.line(centerX + width / 2 + 1.5, lineY - 2.6, cellLeft + columnWidth, lineY - 2.6);
					}
				});
			});

			// Barlines and repeat marks go on top of the note content — drawn
			// first, the fret knockout rects would erase the repeat dots.
			// Left edge: begin-repeat (thick, thin, dots) or a plain bar.
			if (entry.beginRepeat) {
				bar(left, staffTop, 1.6);
				bar(left + 3.2, staffTop, 0.6);
				repeatDots(left + 6.2, staffTop);
			} else if (slot === 0) {
				bar(left, staffTop, 0.6);
			}
			// Right edge: end-repeat, final bar, or a plain bar.
			if (entry.endRepeat > 0) {
				repeatDots(right - 6.2, staffTop);
				bar(right - 3.2, staffTop, 0.6);
				bar(right, staffTop, 1.6);
				setFont("bold", 8.5);
				const label = `×${entry.endRepeat}`;
				text(label, right - doc.getTextWidth(label) - 2, staffTop - 5);
			} else if (entry.final) {
				bar(right - 3.2, staffTop, 0.6);
				bar(right, staffTop, 1.6);
			} else {
				bar(right, staffTop, 0.6);
			}
		});

		printedCount += line.length;
		y = staffTop + staffHeight + LINE_GAP;
	}

	const pageCount = doc.getNumberOfPages();
	if (pageCount > 1) {
		for (let page = 1; page <= pageCount; page++) {
			doc.setPage(page);
			setFont("normal", 8, SOFT);
			const label = `${page} / ${pageCount}`;
			text(label, (pageWidth - doc.getTextWidth(label)) / 2, pageHeight - MARGIN / 2);
		}
	}
	return new Uint8Array(doc.output("arraybuffer"));
}
