import type { EmployeeView, Recommendation } from "../../types/career";

/** Demand visible facts as well as reference labels; history semantics still need review. */
export function containsRequiredFacts(text: string, view: EmployeeView, recommendation: Recommendation): boolean {
  if (!view.target) return false;
  const normalized = text.toLowerCase();
  if (!normalized.includes(view.target.role.toLowerCase()) || !normalized.includes(view.target.grade.toLowerCase())) return false;
  return recommendation.expectedChanges.some((change) => {
    if (Math.min(change.after, change.required) <= Math.min(change.before, change.required)) return false;
    const name = view.skillGaps.find((gap) => gap.skillId === change.skillId)?.name ?? change.skillId;
    return (normalized.includes(name.toLowerCase()) || normalized.includes(change.skillId.toLowerCase())) &&
      new RegExp(`\\b${change.before}\\s*(?:->|\u2192|\u21d2)\\s*${change.after}\\b`).test(text);
  });
}

/** Conservative checks for specific contradictions, not a general semantic truth verifier. */
export function hasUnsupportedClaims(text: string, recommendation: Recommendation): boolean {
  // Explanations are plain text, not links, executable markup or hidden instructions.
  if ([...text].some((character) => character.charCodeAt(0) < 32 && !"\t\n\r".includes(character))) return true;
  if (/https?:\/\/|www\.|<\/?[a-z][^>]*>|[\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/iu.test(text)) return true;
  // Neither probability nor a new percentage metric is part of the model evidence.
  if (/\d\s*[%\u066a\uff05]/u.test(text)) return true;
  for (const [id] of text.matchAll(/\b(?:EV|SK)_[A-Z0-9_]+\b/gu)) {
    if (id.startsWith("EV_") && id !== recommendation.eventId) return true;
    if (id.startsWith("SK_") && !recommendation.expectedChanges.some((change) => change.skillId === id)) return true;
  }
  for (const match of text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:->|\u2192|\u21d2)\s*(\d+(?:[.,]\d+)?)/gu)) {
    const before = Number(match[1]!.replace(",", "."));
    const after = Number(match[2]!.replace(",", "."));
    if (!recommendation.expectedChanges.some((change) => change.before === before && change.after === after)) return true;
  }
  return false;
}
