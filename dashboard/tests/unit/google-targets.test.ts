import { describe, expect, it } from "vitest";
import { calendarTarget, taskTarget } from "../../src/lib/google/targets";

describe("google sync targets", () => {
  const withDueAndTime = {
    has_specific_time: true,
    due_at: new Date("2026-10-21T10:00:00Z"),
  };

  const withDueNoTime = {
    has_specific_time: false,
    due_at: new Date("2026-10-21T00:00:00Z"),
  };

  const noDue = {
    has_specific_time: false,
    due_at: null,
  };

  it("in AUTO mode, routes specific-time todos to calendar only", () => {
    expect(calendarTarget(withDueAndTime, "AUTO")).toBe(true);
    expect(taskTarget(withDueAndTime, "AUTO")).toBe(false);
  });

  it("in AUTO mode, routes date-only todos to tasks only", () => {
    expect(calendarTarget(withDueNoTime, "AUTO")).toBe(false);
    expect(taskTarget(withDueNoTime, "AUTO")).toBe(true);
  });

  it("in AUTO mode without due date, calendar is never targeted", () => {
    expect(calendarTarget(noDue, "AUTO")).toBe(false);
    expect(taskTarget(noDue, "AUTO")).toBe(true);
  });

  it("in BOTH mode, targets both calendar and tasks when due_at is present", () => {
    expect(calendarTarget(withDueAndTime, "BOTH")).toBe(true);
    expect(taskTarget(withDueAndTime, "BOTH")).toBe(true);

    expect(calendarTarget(withDueNoTime, "BOTH")).toBe(true);
    expect(taskTarget(withDueNoTime, "BOTH")).toBe(true);
  });

  it("in BOTH mode without due date, calendarTarget is false and tasks is true", () => {
    expect(calendarTarget(noDue, "BOTH")).toBe(false);
    expect(taskTarget(noDue, "BOTH")).toBe(true);
  });
});
