import { describe, expect, it } from "vitest";
import { exclusionLabel, historyLabel, recommendationLabel } from "../src/lib/frontend/plain-language";
import { getEmployeeView } from "../src/lib/recommendation";
import { normalizeDataset } from "../src/lib/data/normalize";
import { demoDataset } from "./fixtures/career-dataset";

describe("plain-language presentation, not another recommendation engine", () => {
  it("keeps facts and absence of history without inventing preferences", () => {
    expect(historyLabel("No recent comparable participation records; evidence is insufficient to infer a preference.")).toContain("нет похожих занятий");
    expect(historyLabel("3 recent participation signal(s) on related skills and this format reduce suitability.")).toContain("год: 3");
    expect(historyLabel("2 format-only negative record(s) on unrelated topics have limited weight.")).toContain("темы: 2");
    expect(historyLabel("1 externally assigned decline(s) receive reduced weight; this is not a motivation assessment.")).toContain("не оценивают вашу мотивацию");
    expect(historyLabel("5 recent comparable participation record(s), with no negative signal or strong feedback adjustment.")).toContain("год: 5");
    expect(historyLabel("Positive feedback on related skills in this format supports this activity.")).toContain("высоко оценивали");
    expect(historyLabel("Low feedback on related skills in this format reduces suitability.")).toContain("низко оценивали");
    expect(historyLabel("Unknown future server evidence")).toBe("Unknown future server evidence");
  });
  it("preserves specific unmet levels and unknown diagnostic messages", () => {
    expect(exclusionLabel("prerequisites", "Prerequisites are not met: Python: current 1, required 2.")).toBe("Сначала нужны навыки: Python: сейчас 1, нужно 2.");
    expect(exclusionLabel("future_code", "new reason")).toBe("new reason");
  });
  it("uses trusted target and effects without modifying view, scores or ordering", () => {
    const view = getEmployeeView(normalizeDataset(demoDataset), "EMP-014");
    const original = structuredClone(view);
    const text = recommendationLabel(view.recommendations[0], view, {});
    expect(text).toContain(view.target!.role);
    expect(text).toContain(view.target!.grade);
    expect(text).toContain("System design");
    expect(text).not.toContain("advances the");
    expect(view).toEqual(original);
  });
  it("preserves validated AI verbatim and never shows stale AI on fallback", () => {
    const view = getEmployeeView(normalizeDataset(demoDataset), "EMP-014");
    const rec = view.recommendations[0];
    rec.aiExplanation = "Actual provider explanation";
    rec.explanationSource = "llm";
    expect(recommendationLabel(rec, view, {})).toBe(rec.aiExplanation);
    rec.explanationSource = "fallback";
    expect(recommendationLabel(rec, view, {})).not.toContain(rec.aiExplanation);
  });
});
