import { describe, expect, it } from "vitest";
import { addStroke, normalizeStrum, strokesOf, strumArrows, strumLetters } from "../strum";

describe("strum patterns", () => {
	it("adds strokes up to four, then starts over", () => {
		expect(addStroke(null, "d")).toBe("d");
		expect(addStroke("d", "u")).toBe("du");
		expect(addStroke("dudu", "u")).toBe("u");
	});

	it("renders arrows and export letters", () => {
		expect(strokesOf("du")).toEqual(["d", "u"]);
		expect(strumArrows("du")).toBe("↓↑");
		expect(strumLetters("udd")).toBe("UDD");
		expect(strumArrows(null)).toBe("");
	});

	it("migrates the first stored shape and drops garbage", () => {
		expect(normalizeStrum("down")).toBe("d");
		expect(normalizeStrum("up")).toBe("u");
		expect(normalizeStrum("dudu")).toBe("dudu");
		expect(normalizeStrum("dududu")).toBeNull();
		expect(normalizeStrum(null)).toBeNull();
	});
});
