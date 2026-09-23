import { LoaderCircle } from "lucide-react";

export function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><p>{text}</p></div>;
}
export function ErrorState({ title, detail, onRetry }: { title: string; detail: string; onRetry: () => void }) {
  return <section className="panel error-state" role="alert"><h2>{title}</h2><p>{detail}</p><button className="button button-outline" onClick={onRetry}>Повторить</button></section>;
}
export function LoadingState({ text }: { text: string }) {
  return <section className="panel loading-state" role="status" aria-live="polite" aria-busy="true"><LoaderCircle className="spin" size={20} /><p>{text}</p><div className="skeleton" /><div className="skeleton short" /></section>;
}
export function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}
export const formatNumber = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
