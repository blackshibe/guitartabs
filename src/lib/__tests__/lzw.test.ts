import { describe, expect, it } from "vitest";
import { compressText, decompressText, isCompressedExport, lzwCompress, lzwDecompress } from "../lzw";

function roundTripBytes(input: Uint8Array): Uint8Array {
	return lzwDecompress(lzwCompress(input));
}

describe("lzw byte round-trips", () => {
	it("handles empty input", () => {
		expect(roundTripBytes(new Uint8Array(0))).toEqual(new Uint8Array(0));
	});

	it("handles a single byte", () => {
		expect(roundTripBytes(Uint8Array.of(65))).toEqual(Uint8Array.of(65));
	});

	it("handles two identical bytes (immediate KwKwK)", () => {
		expect(roundTripBytes(Uint8Array.of(7, 7))).toEqual(Uint8Array.of(7, 7));
	});

	it("handles a long run of one byte (repeated KwKwK growth)", () => {
		const run = new Uint8Array(10000).fill(42);
		expect(roundTripBytes(run)).toEqual(run);
	});

	it("handles all 256 byte values", () => {
		const all = Uint8Array.from({ length: 256 }, (_, i) => i);
		expect(roundTripBytes(all)).toEqual(all);
	});

	it("handles input crossing every code-width boundary and the dictionary freeze", () => {
		// Non-repeating-ish pattern long enough to push nextCode past 65536.
		const big = new Uint8Array(1_000_000);
		let seed = 12345;
		for (let i = 0; i < big.length; i++) {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			big[i] = seed & 0xff;
		}
		expect(roundTripBytes(big)).toEqual(big);
	});

	it("compresses repetitive input well below its original size", () => {
		const text = new TextEncoder().encode("la la la la ".repeat(2000));
		expect(lzwCompress(text).length).toBeLessThan(text.length / 5);
	});
});

describe("compressText / decompressText", () => {
	it("round-trips unicode text", () => {
		const text = 'ünïcødé ♫ 𝄆 {"a":1}'.repeat(500);
		expect(decompressText(compressText(text))).toBe(text);
	});

	it("round-trips empty text", () => {
		expect(decompressText(compressText(""))).toBe("");
	});

	it("marks its output with the header", () => {
		expect(isCompressedExport(compressText("{}"))).toBe(true);
	});

	it("does not mistake plain JSON for a compressed export", () => {
		expect(isCompressedExport(new TextEncoder().encode('{"id":"x"}'))).toBe(false);
	});

	it("does not mistake short buffers for a compressed export", () => {
		expect(isCompressedExport(Uint8Array.of(0x54, 0x41))).toBe(false);
	});

	it("rejects non-compressed bytes", () => {
		expect(() => decompressText(new TextEncoder().encode("plain"))).toThrow();
	});
});
