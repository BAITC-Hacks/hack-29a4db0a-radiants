import type { EmployeeView, Recommendation } from "../../types/career";

// Presentation of the engine's fixed messages only; unknown provider text is preserved.
export function historyLabel(signal: string): string {
  return signal
    .replace("No recent comparable participation records; evidence is insufficient to infer a preference.", "За последний год нет похожих занятий в вашей истории. Пока нельзя сказать, насколько вам подходит этот формат.")
    .replace(/(\d+) recent comparable participation record\(s\), with no negative signal or strong feedback adjustment\./g, "Похожих записей за последний год: $1. История не даёт причин предпочесть или исключить этот формат.")
    .replace(/(\d+) recent participation signal\(s\) on related skills and this format reduce suitability\./g, "Пропуски, отказы или прерванные занятия по похожей теме за последний год: $1. Это учтено при выборе.")
    .replace(/(\d+) format-only negative record\(s\) on unrelated topics have limited weight\./g, "Пропуски, отказы или прерванные занятия такого формата на другие темы: $1. Они меньше влияют на выбор.")
    .replace(/(\d+) externally assigned decline\(s\) receive reduced weight; this is not a motivation assessment\./g, "Из них отказов от назначенного обучения: $1. Они учитываются мягче и не оценивают вашу мотивацию.")
    .replace("Positive feedback on related skills in this format supports this activity.", "Вы высоко оценивали похожие занятия этого формата.")
    .replace("Low feedback on related skills in this format reduces suitability.", "Вы низко оценивали похожие занятия этого формата. Это учтено при выборе.");
}

export function recommendationLabel(rec: Recommendation, view: EmployeeView, names: Readonly<Record<string, string>>): string {
  if (rec.explanationSource === "llm" && rec.aiExplanation?.trim()) return rec.aiExplanation.trim();
  if (!rec.deterministicExplanation.startsWith(`${rec.title} advances the `) || !view.target) return rec.deterministicExplanation;
  const changes = rec.expectedChanges.filter(change => change.after > change.before && change.required > change.before);
  if (!changes.length) return rec.deterministicExplanation;
  const skills = changes.map(change => view.skillGaps.find(gap => gap.skillId === change.skillId)?.name ?? names[change.skillId] ?? change.skillId);
  return `Для перехода к ${view.target.role} · ${view.target.grade} нужно развить ${skills.join(", ")}. Это занятие поможет приблизить эти навыки к требуемому уровню.`;
}

export const readinessHelp = "Сравниваем каждый навык с требованиями выбранной роли и учитываем уже достигнутый уровень. Ключевые навыки влияют на результат вдвое сильнее. Уровень выше требования не добавляет лишних процентов. Это прогресс в развитии, а не вероятность повышения.";

export const exclusionLabels: Record<string, string> = {
  mandatory: "Обязательное обучение показано отдельно.",
  audience: "Занятие рассчитано на другую роль или уровень.",
  prerequisites: "Сначала нужно развить навыки, необходимые для этого занятия.",
  unavailable: "В расписании пока нет доступной даты.",
  completed: "Это занятие уже пройдено и не предполагает повторного прохождения.",
  in_progress: "Это занятие уже начато.",
  no_gap_reduction: "Это занятие не приближает текущие навыки к выбранной цели.",
};

export function exclusionLabel(code: string, message: string): string {
  if (code === "prerequisites") {
    return message.replace("Prerequisites are not met: ", "Сначала нужны навыки: ").replace(/: current (\d+), required (\d+)/g, ": сейчас $1, нужно $2");
  }
  return exclusionLabels[code] ?? message;
}
