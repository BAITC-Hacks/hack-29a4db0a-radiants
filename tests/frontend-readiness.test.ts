import { describe, expect, it } from "vitest";
import { formatReadiness, formatReadinessDelta, readinessBarValue, readinessDelta } from "../src/lib/frontend/readiness";

describe("readiness presentation precision", () => {
  it.each([[64.2, "64.2%"], [64, "64%"], [71.5, "71.5%"], [100, "100%"], [71.499999999, "71.5%"]] as const)(
    "formats %s as %s", (value, expected) => expect(formatReadiness(value)).toBe(expected),
  );
  it.each([[64.2, 71.5, 7.3], [64, 64.5, 0.5], [64.2, 63.7, -0.5], [64.2, 64.2, 0]])(
    "compares %s → %s without float artifacts", (before, after, expected) => {
      expect(readinessDelta(before, after)).toBe(expected);
      expect(formatReadinessDelta(readinessDelta(before, after))).toBe(
        `${expected > 0 ? "+" : ""}${expected} percentage points`,
      );
    },
  );
  it("normalizes insignificant floating point differences before the zero-state decision", () => {
    expect(Object.is(readinessDelta(64.2, 64.2 - 1e-12), 0)).toBe(true);
    expect(readinessDelta(64.2, 64.2 + 1e-12)).toBe(0);
  });
  it("clamps only geometry, preserving decimals and the supplied numeric label", () => {
    expect(readinessBarValue(64.2)).toBe(64.2);
    expect(readinessBarValue(-0.5)).toBe(0);
    expect(readinessBarValue(101.5)).toBe(100);
    expect(formatReadiness(101.5)).toBe("101.5%");
  });
});
