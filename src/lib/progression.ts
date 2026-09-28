import type { Column, ProgressionEntry, Section, SectionRange, Track } from "../types";
import { strumAt } from "./songOps";
import { COLS_PER_MEASURE, nextId } from "./instruments";

// The arrangement layer. Sections are modules defined once on the measure
// timeline; the progression is the ordered list of "play this module N times"
// steps that the grid renders and playback walks. Expanding it gives a flat
// list of SLOTS — one per rendered/played copy of a section — and every
// position in the editor is addressed as a (slot, measure, column) triple
// whose linear index is a "step" on the expanded timeline.
//
// A section no section-entry references is not lost: it trails the played
// slots as an `unused` slot so its bars stay editable and reachable.

export interface ProgressionSlot {
	/** position in the slot list (played slots first, unused ones after) */
	index: number;
	/** progression entry this copy came from; negative for unused sections */
	entryId: number;
	section: SectionRange;
	/** 0-based pass within the entry's repeat count */
	repeatIndex: number;
	repeatCount: number;
	/** source-timeline measure this section starts at */
	startMeasure: number;
	span: number;
	/** first step of this slot on the expanded timeline */
	startStep: number;
	/** true when no progression entry plays this section */
	unused: boolean;
}

export interface StepLocation {
	slot: ProgressionSlot;
	measure: number;
	column: number;
}

export function defaultProgressionFor(sections: Section[]): ProgressionEntry[] {
	return [...sections]
		.sort((a, b) => a.startMeasure - b.startMeasure)
		.map((section) => ({ id: nextId(), sectionId: section.id, repeat: 1 }));
}

/** Drop entries whose section is gone and clamp repeats; absent — or emptied
 *  by the drop — falls back to each section once, in timeline order, so a
 *  song can never end up with nothing to render. */
export function normalizeProgression(
	progression: ProgressionEntry[] | undefined,
	sections: Section[],
): ProgressionEntry[] {
	if (!progression) return defaultProgressionFor(sections);
	const known = new Set(sections.map((section) => section.id));
	const kept = progression
		.filter((entry) => known.has(entry.sectionId))
		// Imported JSON is unvalidated here — a missing/NaN repeat must not zero
		// out the entry's slots, and an absurd one must not render 100k blocks.
		.map((entry) => ({
			...entry,
			repeat: Number.isFinite(entry.repeat) ? Math.min(64, Math.max(1, Math.floor(entry.repeat))) : 1,
		}));
	return kept.length > 0 || sections.length === 0 ? kept : defaultProgressionFor(sections);
}

export function buildSlots(ranges: SectionRange[], progression: ProgressionEntry[]): ProgressionSlot[] {
	const byId = new Map(ranges.map((range) => [range.id, range]));
	const slots: ProgressionSlot[] = [];
	let step = 0;
	const push = (section: SectionRange, entryId: number, repeatIndex: number, repeatCount: number, unused: boolean) => {
		const span = section.endMeasure - section.startMeasure + 1;
		slots.push({
			index: slots.length,
			entryId,
			section,
			repeatIndex,
			repeatCount,
			startMeasure: section.startMeasure,
			span,
			startStep: step,
			unused,
		});
		step += span * COLS_PER_MEASURE;
	};
	progression.forEach((entry) => {
		const section = byId.get(entry.sectionId);
		if (!section) return;
		const repeatCount = Math.max(1, entry.repeat);
		for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex++) {
			push(section, entry.id, repeatIndex, repeatCount, false);
		}
	});
	const played = new Set(progression.map((entry) => entry.sectionId));
	ranges.filter((range) => !played.has(range.id)).forEach((range) => push(range, -range.id, 0, 1, true));
	return slots;
}

/** Seconds one step lasts while `slot` plays — its section's tempo override,
 *  or the song tempo. */
export function slotStepSeconds(slot: ProgressionSlot, songBpm: number): number {
	return 60 / (slot.section.bpm ?? songBpm) / 2;
}

/** Seconds from the arrangement top (step 0) to `step`, integrating each
 *  slot's tempo. With no section overrides this collapses to
 *  `step * 60/bpm/2`; steps past the last slot extrapolate at the song tempo. */
export function secondsAtStep(slots: ProgressionSlot[], songBpm: number, step: number): number {
	let seconds = 0;
	let remaining = step;
	for (const slot of slots) {
		if (remaining <= 0) break;
		const take = Math.min(remaining, slot.span * COLS_PER_MEASURE);
		seconds += take * slotStepSeconds(slot, songBpm);
		remaining -= take;
	}
	return seconds + Math.max(0, remaining) * (60 / songBpm / 2);
}

/** Steps playback actually covers — the unused slots trail past this. */
export function playableSteps(slots: ProgressionSlot[]): number {
	return slots
		.filter((slot) => !slot.unused)
		.reduce((total, slot) => total + slot.span * COLS_PER_MEASURE, 0);
}

export function stepOf(slot: ProgressionSlot, measure: number, column: number): number {
	return slot.startStep + (measure - slot.startMeasure) * COLS_PER_MEASURE + column;
}

/** The slot a source measure is being shown in, preferring the cursor's own
 *  slot — one measure can be on screen several times over. */
export function slotForMeasure(
	slots: ProgressionSlot[],
	measure: number,
	preferIndex = 0,
): ProgressionSlot | undefined {
	const holds = (slot: ProgressionSlot) => measure >= slot.startMeasure && measure < slot.startMeasure + slot.span;
	const preferred = slots[preferIndex];
	return preferred && holds(preferred) ? preferred : slots.find(holds);
}

export function locateStep(slots: ProgressionSlot[], step: number): StepLocation | null {
	for (const slot of slots) {
		const end = slot.startStep + slot.span * COLS_PER_MEASURE;
		if (step >= slot.startStep && step < end) {
			const offset = step - slot.startStep;
			return {
				slot,
				measure: slot.startMeasure + Math.floor(offset / COLS_PER_MEASURE),
				column: offset % COLS_PER_MEASURE,
			};
		}
	}
	return null;
}

/** Where a newly created section should slot into the arrangement: right
 *  after the last entry whose section starts earlier on the timeline. */
export function entryIndexForSection(
	progression: ProgressionEntry[],
	sections: Section[],
	startMeasure: number,
): number {
	const startOf = new Map(sections.map((section) => [section.id, section.startMeasure]));
	let index = 0;
	progression.forEach((entry, position) => {
		if ((startOf.get(entry.sectionId) ?? -1) < startMeasure) index = position + 1;
	});
	return index;
}

function columnHasNotes(column: Column | undefined): boolean {
	return column?.some((value) => value !== null && value !== "") ?? false;
}

/** A strum mark on a column with no frets re-strums the chord held from before. */
export function isRestrum(track: Track, measure: number, column: number): boolean {
	return strumAt(track, measure, column) !== null && !columnHasNotes(track.measures[measure]?.[column]);
}

// The cells a step sounds for a track: its own frets, or — on a restrum — the
// last chord played before it in arrangement order.
export function soundingCellsAt(slots: ProgressionSlot[], track: Track, step: number): Column | undefined {
	const at = locateStep(slots, step);
	if (!at) return undefined;
	const own = track.measures[at.measure]?.[at.column];
	if (!isRestrum(track, at.measure, at.column)) return own;
	for (let back = step - 1; back >= 0; back--) {
		const earlier = locateStep(slots, back);
		if (!earlier) break;
		const cells = track.measures[earlier.measure]?.[earlier.column];
		if (columnHasNotes(cells)) return cells;
	}
	return own;
}
