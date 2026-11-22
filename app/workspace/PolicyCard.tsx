"use client";
import { CATEGORIES, type Card } from "@/lib/planner/types";
import { dateLabel } from "@/lib/planner/dates";
import s from "./workspace.module.css";
export function deadlineText(card: Card, today: string) {
  if (card.deadlineKind === "closed") return "접수 마감";
  if (card.deadlineKind === "rolling") return "현재 계획에 정해진 기한 없음";
  if (card.deadlineKind === "unknown") return card.official.kind === "budget" ? "예산 소진 시 종료" : card.official.end ? `공고 마감 ${dateLabel(card.official.end, today)} · 내 기한 확인 필요` : "공고 마감 확인 필요";
  return `${card.deadlineKind === "personal_estimate" ? "내 예상 기한" : "신청 기한"} ${dateLabel(card.personalWindow?.end ?? card.official.end, today)}`;
}
export function actionText(card: Card) {
  if (card.selectedStageId === card.stageId) return "✓ 담음";
  if (card.canReplace) return "비교·교체";
  if (card.availability === "blocked") return "제한 사유";
  if (card.selectedStageId) return "이 시점에 담기";
  return "담기";
}
export function PolicyCard({ card, today, recommended, onDetail, onChoose, disabled, surface = "board", starred = false, onStar }: { card: Card; today: string; recommended: boolean; onDetail: (c: Card) => void; onChoose: (c: Card) => void; disabled: boolean; surface?: string; starred?: boolean; onStar?: () => void }) {
  const chosen = card.selectedStageId === card.stageId, blocked = card.availability === "blocked", deadline = deadlineText(card, today);
  // 대표 주의 사유 한 줄: 막힘·확인 필요는 첫 사유, 신청 가능은 부분 제한(설계 6.3 "신청 가능 + 주의 사유"). 상세에는 전체 사유.
  const needsCheck = card.availability === "needs_check";
  const warning = blocked || needsCheck ? card.reasons[0] : card.reasons.find(r => r.code === "PARTIAL_RESTRICTION");
  const dday = card.deadlineKind === "closed" ? "마감" : card.daysLeft === null ? card.deadlineKind === "rolling" ? "상시" : "기한 확인" : card.daysLeft === 0 ? "D-day" : `D−${card.daysLeft}`;
  return <article id={`${surface}-${card.stageId}-${card.offeringId}`} className={`${s.policyCard} ${chosen ? s.chosen : ""} ${blocked ? s.blocked : ""} ${recommended ? s.recommended : ""}`} aria-label={`${card.title}, ${deadline}${card.daysLeft !== null ? `, ${card.daysLeft}일 남음` : ""}`}><div className={s.cardTop}><span className={s.category} style={{ color: CATEGORIES[card.category].color }}><span style={{ background: CATEGORIES[card.category].color }} />{CATEGORIES[card.category].label}</span><span className={`${s.dday} ${card.daysLeft !== null && card.daysLeft <= 10 ? s.urgent : ""}`}>{dday}</span></div>{onStar && <button className={s.starButton} aria-label={starred ? `${card.title} 별표 해제` : `${card.title} 별표 저장`} aria-pressed={starred} onClick={onStar}>{starred ? "★" : "☆"}</button>}<button className={s.cardTitle} onClick={() => onDetail(card)} title={`${card.summary}\n${card.official.start ? `${dateLabel(card.official.start, today)}부터 접수` : "접수 시작일 확인"}`}><span>{card.title}</span> {card.verifyLabel && <span className={s.demoBadge}>{card.verifyLabel}</span>}</button>{recommended && <span className={s.recommendBadge}>추천</span>}<p className={s.cardDeadline}>{deadline}</p>{card.deadlineKind === "personal_estimate" && <p className={s.cardMeta}>{card.reasons.find(r => r.code === "BEFORE_EVENT")?.message.split(" 예정일")[0] ?? "예정일"} 예정일 기준 · 공고 마감 {dateLabel(card.official.end, today)}</p>}<p className={s.cardSupport}>{card.support || card.summary || "지원 내용은 상세 공고에서 확인해 주세요."}</p>{card.official.start && card.official.start > today && <p className={s.cardMeta}>{dateLabel(card.official.start, today)}부터 접수</p>}{warning && <p className={blocked ? s.cardWarning : warning.code === "PARTIAL_RESTRICTION" && !needsCheck ? s.partialNote : s.checkNote}>{warning.message}</p>}<div className={s.cardBottom}><span>{card.availability === "needs_check" ? "확인 필요" : blocked ? "신청 제한" : card.stageId !== "current" ? "예정일 기준" : "조건 충족"}</span><button className={chosen ? s.chosenButton : s.addButton} disabled={disabled} onClick={() => blocked && !card.canReplace && !chosen ? onDetail(card) : onChoose(card)}>{actionText(card)}</button></div></article>;
}
