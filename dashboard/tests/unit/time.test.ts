import { describe, expect, it } from "vitest";
import {
  dateFromLocalNoon,
  inWindow,
  lastNDays,
  localDateString,
  localDateTimeToUtc,
  localIsoString,
  localTimeString,
  nextWorkingDay,
} from "../../src/lib/time";

const JAKARTA = "Asia/Jakarta";

describe("datetime", () => {
  it("formats Jakarta local time and date from a UTC instant", () => {
    const instant = new Date("2026-10-20T02:30:00Z");
    expect(localTimeString(instant, JAKARTA)).toBe("09:30");
    expect(localDateString(instant, JAKARTA)).toBe("2026-10-20");
    expect(localIsoString(instant, JAKARTA)).toBe("2026-10-20T09:30:00+07:00");
  });

  it("checks a work-hour window", () => {
    const instant = new Date("2026-10-20T02:30:00Z");
    expect(inWindow(instant, JAKARTA, "08:00", 120)).toBe(true);
    expect(inWindow(instant, JAKARTA, "09:31", 120)).toBe(false);
  });

  it("skips weekend when finding the next working day", () => {
    const fridayNoon = new Date("2026-10-23T05:00:00Z");
    expect(nextWorkingDay(fridayNoon, JAKARTA, [1, 2, 3, 4, 5])).toBe(
      "2026-10-26",
    );
  });

  it("converts local midnight and noon to UTC", () => {
    expect(localDateTimeToUtc("2026-10-20", JAKARTA).toISOString()).toBe(
      "2026-10-19T17:00:00.000Z",
    );
    expect(dateFromLocalNoon("2026-10-20", JAKARTA).toISOString()).toBe(
      "2026-10-20T05:00:00.000Z",
    );
  });

  it("returns the last N local dates in ascending order", () => {
    const instant = new Date("2026-10-20T02:30:00Z");
    expect(lastNDays(instant, JAKARTA, 3)).toEqual([
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
    ]);
  });
});
