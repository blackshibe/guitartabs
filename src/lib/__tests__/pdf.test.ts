import { describe, expect, it } from "vitest";
import { buildTrackPdf } from "../pdf";
import { buildSong, buildTrack, poke } from "./helpers";

const asString = (bytes: Uint8Array) => {
	let out = "";
	for (const byte of bytes) out += String.fromCharCode(byte);
	return out;
};
const pageCount = (file: string) => file.match(/\/Type \/Page[^s]/g)?.length ?? 0;

describe("buildTrackPdf", () => {
	it("produces a one-page PDF with title, section label, tuning letters, and fret numbers", () => {
		const track = buildTrack(10, 1);
		poke(track, 0, 0, 0, "5");
		poke(track, 0, 3, 1, "12");
		const file = asString(buildTrackPdf(buildSong({ measureCount: 1, tracks: [track] }), 10));
		expect(file.startsWith("%PDF")).toBe(true);
		expect(pageCount(file)).toBe(1);
		expect(file).toContain("Helvetica");
		expect(file).toContain("(Test Song) Tj");
		expect(file).toContain("(Intro) Tj");
		expect(file).toContain("(5) Tj");
		expect(file).toContain("(12) Tj");
	});

	it("draws the TAB clef letters", () => {
		const track = buildTrack(10, 1);
		poke(track, 0, 0, 0, "5");
		const file = asString(buildTrackPdf(buildSong({ measureCount: 1, tracks: [track] }), 10));
		for (const letter of ["T", "A", "B"]) expect(file).toContain(`(${letter}) Tj`);
	});

	it("prints the fold count over the end-repeat bar of a repeated section", () => {
		// 8 identical bars fold to a 1-bar unit ×8, written out to a full line ×2
		const track = buildTrack(10, 8);
		for (let m = 0; m < 8; m++) poke(track, m, 0, 0, "3");
		const file = asString(buildTrackPdf(buildSong({ measureCount: 8, tracks: [track] }), 10));
		expect(file).toContain("(\xd72) Tj");
	});

	it("renders only the requested track", () => {
		const a = buildTrack(10, 1);
		const b = buildTrack(11, 1);
		poke(a, 0, 0, 0, "5");
		poke(b, 0, 0, 0, "9");
		const file = asString(buildTrackPdf(buildSong({ measureCount: 1, tracks: [a, b] }), 11));
		expect(file).toContain("(9) Tj");
		expect(file).not.toContain("(5) Tj");
	});

	it("keeps harmonics bracketed and maps non-Latin-1 to '?'", () => {
		const track = buildTrack(10, 1);
		poke(track, 0, 0, 0, "<7>");
		const song = buildSong({ measureCount: 1, tracks: [track], title: "So Long ♪" });
		const file = asString(buildTrackPdf(song, 10));
		expect(file).toContain("(<7>) Tj");
		expect(file).toContain("(So Long ?) Tj");
	});

	it("paginates a long song and numbers the pages", () => {
		const track = buildTrack(10, 80);
		for (let m = 0; m < 80; m++) poke(track, m, m % 8, 0, String(m % 10));
		const sections = Array.from({ length: 20 }, (_, i) => ({
			id: i + 1,
			name: `Part ${i}`,
			startMeasure: i * 4,
		}));
		const file = asString(buildTrackPdf(buildSong({ measureCount: 80, tracks: [track], sections }), 10));
		expect(pageCount(file)).toBeGreaterThan(1);
		expect(file).toContain(`(1 / ${pageCount(file)}) Tj`);
	});

	it("tightens a page to keep a section's closing line on it", () => {
		// One section, so every line but the last continues it without closing it.
		const pagesFor = (bars: number) => {
			const track = buildTrack(10, bars);
			for (let m = 0; m < bars; m++) poke(track, m, m % 8, 0, String(m % 10));
			poke(track, 0, 7, 1, "5"); // bar 0 is unique, so the section never folds into a repeat
			return pageCount(asString(buildTrackPdf(buildSong({ measureCount: bars, tracks: [track] }), 10)));
		};
		// With one more line after it, the line ending at `bars` doesn't close the
		// section, so the first time that breaks marks the first line off the page.
		let bars = 8;
		while (pagesFor(bars + 4) === 1) bars += 4;
		// As the section's closing line, that same line is squeezed in.
		expect(pagesFor(bars)).toBe(1);
	});

	it("can start every section on a new line", () => {
		// Two 2-bar sections: one line when bars flow, two when sections break.
		const track = buildTrack(10, 4);
		for (let m = 0; m < 4; m++) poke(track, m, 0, 0, String(m + 1));
		const song = buildSong({
			measureCount: 4,
			tracks: [track],
			sections: [
				{ id: 1, name: "Verse", startMeasure: 0 },
				{ id: 2, name: "Chorus", startMeasure: 2 },
			],
		});
		// Section names ride the head row of their line — same y means same line.
		const labelY = (file: string, label: string) => file.match(new RegExp(`([\\d.]+) Td\\n\\(${label}\\) Tj`))?.[1];
		const flowing = asString(buildTrackPdf(song, 10));
		expect(labelY(flowing, "Chorus")).toBe(labelY(flowing, "Verse"));
		const broken = asString(buildTrackPdf(song, 10, { sectionPerLine: true }));
		expect(Number(labelY(broken, "Chorus"))).toBeLessThan(Number(labelY(broken, "Verse")));
	});

	it("returns an empty single page for an unknown track id", () => {
		const file = asString(buildTrackPdf(buildSong(), 999));
		expect(pageCount(file)).toBe(1);
	});
});
