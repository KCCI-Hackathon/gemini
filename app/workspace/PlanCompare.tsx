"use client";
import { useEffect, useState } from "react";
import type { SavedPlan } from "@/lib/planner/types";
import { comparePlans } from "@/lib/planner/compare";
import { fullDate } from "@/lib/planner/dates";
import { toKstDate } from "@/lib/date";
import s from "./workspace.module.css";

const SOURCE = { manual: "직접 만든 계획", recommendation: "추천으로 만든 계획", example: "예시 계획" } as const;
// createdAt 은 UTC ISO 시각이라 한국 날짜로 바꿔 보여 준다
const savedOn = (plan: SavedPlan) => fullDate(toKstDate(new Date(plan.createdAt)));

/** 저장한 계획의 정책(회차) 이름과 회차 이름. 같은 정책 이름의 다른 회차를 구분하려고 회차도 함께 보여 준다 */
function offering(plan: SavedPlan, offeringId: string) {
  const card = plan.savedEvaluation.cards.find(c => c.offeringId === offeringId);
  return { title: card?.title ?? offeringId, round: card?.roundLabel ?? null };
}
function stageText(plan: SavedPlan, stageId: string | undefined) {
  const stage = plan.savedEvaluation.stages.find(st => st.stageId === stageId);
  return stage ? `${stage.label} · ${fullDate(stage.start)}부터` : "시점 정보 없음";
}

function PlanSummary({ plan }: { plan: SavedPlan }) {
  return <dl className={s.planFacts}>
    <dt>담은 정책</dt><dd>{plan.input.choices.length}개</dd>
    <dt>판정 기준일</dt><dd>{fullDate(plan.savedEvaluation.today)}</dd>
    <dt>저장</dt><dd>{savedOn(plan)} · {SOURCE[plan.source]}</dd>
  </dl>;
}

type Item = { key: string; title: string; round: string | null; detail: string };
function Group({ tone, label, hint, items }: { tone: "a" | "both" | "moved" | "b"; label: string; hint: string; items: Item[] }) {
  return <section className={`${s.compareGroup} ${s[`tone_${tone}`]}`} aria-label={`${label} ${items.length}개`}>
    <header><strong>{label}</strong><span className={s.compareCount}>{items.length}</span></header>
    <p className={s.compareHint}>{hint}</p>
    {items.length ? <ul>{items.map(item => <li key={item.key}><b>{item.title}</b>{item.round && <small>{item.round}</small>}<small>{item.detail}</small></li>)}</ul> : <p className={s.compareNone}>해당하는 정책이 없어요.</p>}
  </section>;
}

export function PlanCompare({ plans, onStart }: { plans: SavedPlan[]; onStart?: () => void }) {
  const [a, setA] = useState(plans[0]?.planId ?? ""), [b, setB] = useState(plans[1]?.planId ?? "");
  useEffect(() => {
    if (!plans.some(p => p.planId === a)) setA(plans[0]?.planId ?? "");
    if (!plans.some(p => p.planId === b)) setB(plans.find(p => p.planId !== (plans[0]?.planId ?? ""))?.planId ?? "");
  }, [plans, a, b]);
  const left = plans.find(p => p.planId === a), right = plans.find(p => p.planId === b);
  // 두 계획을 고를 때마다 그 자리에서 다시 계산한다(이전 결과를 들고 있지 않음).
  const result = left && right && a !== b ? comparePlans(left, right) : null;
  const stageOf = (plan: SavedPlan, id: string) => plan.input.choices.find(c => c.offeringId === id)?.stageId;
  const items = (plan: SavedPlan, ids: string[], detail: (id: string) => string): Item[] => ids.map(id => ({ key: id, ...offering(plan, id), detail: detail(id) }));
  const picker = (label: string, tone: "a" | "b", value: string, set: (v: string) => void, plan: SavedPlan | undefined) => <div className={`${s.planSlot} ${s[`tone_${tone}`]}`}>
    <label className={s.compareField}>{label}<select className={s.picker} value={value} onChange={e => set(e.target.value)}>{plans.map(p => <option value={p.planId} key={p.planId}>{p.name} · {p.input.choices.length}개 · {savedOn(p)}</option>)}</select></label>
    {plan && <PlanSummary plan={plan} />}
  </div>;

  return <details className={`${s.panel} ${s.compareBox}`} open={plans.length >= 2}>
    <summary><strong>저장 계획 비교</strong><span>{plans.length < 2 ? "계획을 두 개 이상 저장하면 비교할 수 있어요" : `저장한 계획 ${plans.length}개 중 두 개를 골라 비교해요`}</span></summary>
    {plans.length === 0 && <div className={s.compareEmpty}><p>아직 저장한 계획이 없어요. 정책 선택 화면에서 정책을 담고 ‘계획 저장’을 눌러 주세요.</p>{onStart && <button type="button" className={s.outlineButton} onClick={onStart}>정책 고르러 가기</button>}</div>}
    {plans.length === 1 && <div className={s.compareEmpty}>
      <div className={s.planSlot}><strong>{plans[0].name}</strong><PlanSummary plan={plans[0]} /></div>
      <p>계획을 하나 더 저장하면 두 계획을 나란히 비교할 수 있어요. 일정을 바꾸거나 다른 정책을 담아 새 계획으로 저장해 보세요.</p>{onStart && <button type="button" className={s.outlineButton} onClick={onStart}>정책 고르러 가기</button>}
    </div>}
    {plans.length >= 2 && <>
      <div className={s.comparePair}>{picker("첫 계획", "a", a, setA, left)}<span className={s.compareVs} aria-hidden="true">비교</span>{picker("둘째 계획", "b", b, setB, right)}</div>
      {a === b && <p className={s.warningText} role="status">같은 계획을 두 번 골랐어요. 서로 다른 계획을 골라야 비교할 수 있어요.</p>}
      {result && left && right && <div className={s.compareResult}>
        <Group tone="a" label="첫 계획에만" hint={`${left.name}에만 담긴 정책`} items={items(left, result.onlyA, id => stageText(left, stageOf(left, id)))} />
        <Group tone="both" label="공통" hint="두 계획에 같은 시점으로 담긴 정책" items={items(left, result.both.filter(id => !result.moved.includes(id)), id => stageText(left, stageOf(left, id)))} />
        <Group tone="moved" label="시점 변경" hint="두 계획에 모두 있지만 담은 시점이 다른 정책" items={items(left, result.moved, id => `${stageText(left, stageOf(left, id))} → ${stageText(right, stageOf(right, id))}`)} />
        <Group tone="b" label="둘째 계획에만" hint={`${right.name}에만 담긴 정책`} items={items(right, result.onlyB, id => stageText(right, stageOf(right, id)))} />
      </div>}
    </>}
  </details>;
}
