"use client";
import { useEffect, useState } from "react";
import type { SavedPlan } from "@/lib/planner/types";
import { comparePlans } from "@/lib/planner/compare";
import s from "./workspace.module.css";
export function PlanCompare({ plans }: { plans: SavedPlan[] }) {
  const [a, setA] = useState(plans[0]?.planId ?? ""), [b, setB] = useState(plans[1]?.planId ?? "");
  useEffect(() => {
    if (!plans.some(p => p.planId === a)) setA(plans[0]?.planId ?? "");
    if (!plans.some(p => p.planId === b)) setB(plans.find(p => p.planId !== (plans[0]?.planId ?? ""))?.planId ?? "");
  }, [plans, a, b]);
  const left = plans.find(p => p.planId === a), right = plans.find(p => p.planId === b);
  // 두 계획을 고르면 바로 비교한다(따로 누르는 버튼 없음).
  const result = left && right && a !== b ? comparePlans(left, right) : null;
  const name = (id: string) => left?.savedEvaluation.cards.find(c => c.offeringId === id)?.title ?? right?.savedEvaluation.cards.find(c => c.offeringId === id)?.title ?? id;
  const picker = (label: string, value: string, set: (v: string) => void) => <label className={s.compareField}>{label}<select className={s.picker} value={value} onChange={e => set(e.target.value)}>{plans.map(p => <option value={p.planId} key={p.planId}>{p.name} · {p.input.choices.length}개</option>)}</select></label>;
  return <details className={`${s.panel} ${s.compareBox}`}><summary><strong>저장 계획 비교</strong><span>{plans.length < 2 ? "계획을 두 개 이상 저장하면 비교할 수 있어요" : `저장한 계획 ${plans.length}개`}</span></summary>
    {plans.length >= 2 && <><div className={s.compareFields}>{picker("첫 계획", a, setA)}{picker("둘째 계획", b, setB)}</div>
    {a === b && <p className={s.emptyHint}>서로 다른 계획 두 개를 골라 주세요.</p>}
    {result && <div className={s.compareResult}>{([["공통", result.both], ["첫 계획에만", result.onlyA], ["둘째 계획에만", result.onlyB], ["시점이 바뀐 정책", result.moved]] as const).map(([label, ids]) => <div key={label}><strong>{label} <span>{ids.length}</span></strong><p>{ids.map(name).join(", ") || "없음"}</p></div>)}</div>}</>}
  </details>;
}
