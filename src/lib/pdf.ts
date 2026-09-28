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
import { strumAt } from "./songOps";
import { strokesOf } from "./strum";

const MARGIN = 48;
const STRING_GAP = 9; // between staff lines
const FRET_SIZE = 7;
const STAFF_INDENT = 20; // room for the tuning letters
const TAB_CLEF_WIDTH = 16; // room for the stacked TAB letters at line start
const LINE_HEAD = 20; // band above each line for section names, ×N, measure numbers
const LINE_GAP = 12; // between systems
const COMMENT_SIZE = 7;
const COMMENT_LEAD = 8.5; // between wrapped comment rows
const STRUM_SPACE = 14; // band under the staff for strum arrows
const FOOTER_SPACE = 26;
// How far a page may tighten to keep a section's closing line on it: each
// line gap can shrink to MIN_LINE_GAP, and the last line may reach this far
// into the footer band (still clear of the page number).
const MIN_LINE_GAP = 4;
const SQUEEZE_INTO_FOOTER = 14;

// Grayscale ink levels (0 black – 255 white).
const SOFT = 100;
const STAFF = 140;
const BAR = 60;
const BEAT_SHADOW = 215;

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
	/** 1-based bar number as played — a repeated block's bars carry their
	 *  first pass's numbers and the bars after it count every pass */
	bar: number;
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
	/** first measure of its block — anything else continues a section */
	blockStart: boolean;
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
				bar: block.startBar + offset + 1,
				fill,
				fillPosition: offset * COLS_PER_MEASURE,
				label: offset === 0 && block.name ? block.name : undefined,
				comment: offset === 0 && block.comments.length > 0 ? block.comments.join(" · ") : undefined,
				beginRepeat: offset === 0 && block.repeats > 1,
				endRepeat: last && block.repeats > 1 ? block.repeats : 0,
				final: last && blockIndex === blocks.length - 1,
				blockStart: offset === 0,
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
	const lineWidth = pageWidth - MARGIN - notesX;
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

	// Everything about a line's geometry that depends on what's on it.
	const layout = (line: PrintedMeasure[]) => {
		const measureWidth = lineWidth / MEASURES_PER_LINE;
		const staffRight = notesX + line.length * measureWidth;
		// Comments wrap onto their own rows between the head row and the staff,
		// each only as wide as the room before the next comment on the line, so
		// a long one pushes the staff down instead of running over the measures.
		setFont("italic", COMMENT_SIZE, SOFT);
		const commentRows = line.map((entry, slot) => {
			if (!entry.comment) return [];
			const nextSlot = line.findIndex((other, index) => index > slot && other.comment);
			const limit = nextSlot === -1 ? staffRight : notesX + nextSlot * measureWidth;
			return doc.splitTextToSize(sanitize(entry.comment), limit - (notesX + slot * measureWidth) - 4) as string[];
		});
		const commentBand = Math.max(0, ...commentRows.map((rows) => rows.length)) * COMMENT_LEAD;
		const strummed = line.some((entry) =>
			Array.from({ length: COLS_PER_MEASURE }, (_, column) => strumAt(track, entry.measureIndex, column)).some(
				(strum) => strum !== null,
			),
		);
		// A line only needs the full head band when something rides above the
		// staff (section name, ×N); plain continuation lines stay tight.
		const lineHead =
			(line.some((entry) => entry.label || entry.comment || entry.endRepeat > 0) ? LINE_HEAD : 8) + commentBand;
		const lineFoot = strummed ? STRUM_SPACE : 0;
		return {
			measureWidth,
			staffRight,
			commentRows,
			commentBand,
			lineHead,
			height: lineHead + staffHeight + lineFoot,
		};
	};

	// Pagination is planned before anything is drawn, so lines already placed
	// can still move: when the line that closes a section would spill onto the
	// next page, the page tightens its line gaps (and dips into the footer band)
	// to keep the section's ending with the rest of it.
	const entries = printedMeasures(song, track);
	const pageBottom = pageHeight - MARGIN - FOOTER_SPACE;
	const planned: { line: PrintedMeasure[]; firstIndex: number; y: number; page: number }[] = [];
	let planY = MARGIN + 48;
	let planPage = 1;
	let cursor = 0;
	while (cursor < entries.length) {
		const line = entries.slice(cursor, cursor + MEASURES_PER_LINE);
		const { height } = layout(line);
		const overflow = planY + height - pageBottom;
		if (overflow > 0) {
			const onPage = planned.filter((placed) => placed.page === planPage);
			// The line continues a section already on this page and ends it.
			const closesSection =
				!line[0].blockStart &&
				line.some((_, index) => {
					const next = entries[cursor + index + 1];
					return next === undefined || next.blockStart;
				});
			// Every line on the page (and this one) sits after a gap that can shrink.
			const gapSlack = onPage.length * (LINE_GAP - MIN_LINE_GAP);
			if (closesSection && onPage.length > 0 && overflow <= gapSlack + SQUEEZE_INTO_FOOTER) {
				const shrink = Math.min(overflow, gapSlack) / onPage.length;
				onPage.forEach((placed, index) => {
					placed.y -= shrink * index;
				});
				planned.push({ line, firstIndex: cursor, y: planY - shrink * onPage.length, page: planPage });
				planY = pageBottom + SQUEEZE_INTO_FOOTER + 1; // the page is full
				cursor += line.length;
				continue;
			}
			planPage += 1;
			planY = MARGIN;
		}
		planned.push({ line, firstIndex: cursor, y: planY, page: planPage });
		planY += height + LINE_GAP;
		cursor += line.length;
	}

	let currentPage = 1;
	planned.forEach(({ line, firstIndex: printedCount, y, page }) => {
		if (page !== currentPage) {
			doc.addPage();
			currentPage = page;
		}
		const { measureWidth, staffRight, commentRows, commentBand, lineHead } = layout(line);
		const staffTop = y + lineHead;
		const staffBottom = staffTop + staffHeight;
		// Measure numbers, section names and ×N share the head row, above any comments.
		const headY = staffTop - 5 - commentBand;
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
		line.forEach((entry, slot) => {
			const left = notesX + slot * measureWidth;
			const right = left + measureWidth;
			// Every measure carries its played bar number at its top-left.
			const measureNumber = String(entry.bar);
			setFont("normal", 6.5, SOFT);
			text(measureNumber, left + 1.5, headY);
			// Section name after the measure number, its comment rows under it —
			// a nameless section still gets its comment printed.
			if (entry.label) {
				setFont("bold", 8.5);
				text(entry.label, left + 1.5 + doc.getTextWidth(measureNumber) + 4, headY);
			}
			setFont("italic", COMMENT_SIZE, SOFT);
			commentRows[slot].forEach((row, index) => {
				text(row, left + 1.5, headY + (index + 1) * COMMENT_LEAD);
			});

			// Each note sits at the START of its slot and the last slot ends at
			// the barline, so beats and barlines fall on one even grid (beat 4 →
			// barline is a full beat). Only a small lead-in pad precedes the first
			// note — wider after begin-repeat dots — and end-repeat bars stop their
			// slots a little short so the last fret clears the dots.
			const leadPad = entry.beginRepeat ? 12 : 7;
			const tailPad = entry.endRepeat > 0 ? 4 : 0;
			const slotWidth = (measureWidth - leadPad - tailPad) / COLS_PER_MEASURE;
			const noteX = (columnIndex: number) => left + leadPad + columnIndex * slotWidth;

			// Shadow beat lines through each beat's notes (two 8th columns per
			// beat), drawn under the frets so their knockouts cut through them.
			doc.setDrawColor(BEAT_SHADOW);
			doc.setLineWidth(0.4);
			for (let column = 0; column < COLS_PER_MEASURE; column += 2) {
				doc.line(noteX(column), staffTop, noteX(column), staffBottom);
			}

			const measure = track.measures[entry.measureIndex] ?? [];
			measure.forEach((column, columnIndex) => {
				const position = entry.fillPosition + columnIndex;
				const centerX = noteX(columnIndex);
				// The slot this note owns; the first one reaches back to the
				// barline so a ring line carried in from the last bar stays unbroken.
				const slotLeft = columnIndex === 0 ? left : centerX;
				const slotRight = centerX + slotWidth;
				// Strum arrows under the staff, one per stroke across the column: a
				// stem with its head at the end the strum travels to (down = toward
				// the low strings drawn below).
				const strokes = strokesOf(strumAt(track, entry.measureIndex, columnIndex));
				const pitch = Math.min(4.2, (slotWidth - 1) / Math.max(1, strokes.length));
				const halfHead = Math.min(1.8, pitch / 2 - 0.2);
				strokes.forEach((stroke, index) => {
					const x = centerX + (index - (strokes.length - 1) / 2) * pitch;
					const top = staffBottom + 3.5;
					const bottom = top + 8;
					const tip = stroke === "d" ? bottom : top;
					const back = stroke === "d" ? -2.6 : 2.6;
					doc.setDrawColor(BAR);
					doc.setFillColor(BAR, BAR, BAR);
					doc.setLineWidth(0.6);
					doc.line(x, top, x, bottom);
					doc.triangle(x - halfHead, tip + back, x + halfHead, tip + back, x, tip, "F");
				});
				column.forEach((value, stringIndex) => {
					const lineY = stringY(stringIndex);
					// Ring continuation: a thin line just above the string.
					doc.setDrawColor(STAFF);
					doc.setLineWidth(0.5);
					if (entry.fill[stringIndex]?.[position]) {
						doc.line(slotLeft, lineY - 2.6, slotRight, lineY - 2.6);
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
						doc.line(centerX + width / 2 + 1.5, lineY - 2.6, slotRight, lineY - 2.6);
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
				text(label, right - doc.getTextWidth(label) - 2, headY);
			} else if (entry.final) {
				bar(right - 3.2, staffTop, 0.6);
				bar(right, staffTop, 1.6);
			} else {
				bar(right, staffTop, 0.6);
			}
		});
	});

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
