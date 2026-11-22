import type { Evaluation, Card } from "@/lib/planner/types";
import { PolicyCard } from "./PolicyCard";
import s from "./workspace.module.css";
export function Saved({ stars, evaluation, onToggle, onDetail, onChoose, busy }: { stars: string[]; evaluation: Evaluation; onToggle: (id: string) => void; onDetail: (card: Card) => void; onChoose: (card: Card) => void; busy: boolean }) {
  return <section aria-label="관심 정책" className={s.savedGrid}>{stars.length ? stars.map(id => {
    const card = evaluation.cards.find(c => c.policyId === id);
    return card ? <PolicyCard key={id} card={card} today={evaluation.today} recommended={false} disabled={busy} starred onStar={() => onToggle(id)} onDetail={onDetail} onChoose={onChoose} surface="saved" />
      : <article key={id} className={s.policyCard}><strong>{id}</strong><p>지금 판정에 없어요(회차 마감 등)</p><button className={s.outlineButton} onClick={() => onToggle(id)}>별표 해제</button></article>;
  }) : <p className={s.emptyState}>별표한 정책이 아직 없어요.</p>}</section>;
}
