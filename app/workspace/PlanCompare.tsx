"use client";
import { useEffect, useState } from "react";
import type { SavedPlan } from "@/lib/planner/types";
import { comparePlans } from "@/lib/planner/compare";
import s from "./workspace.module.css";
export function PlanCompare({ plans }: { plans: SavedPlan[] }) {
  const [a, setA] = useState(plans[0]?.planId ?? ""), [b, setB] = useState(plans[1]?.planId ?? "");
  const [compared, setCompared] = useState<string | null>(null);
  useEffect(() => {
    if (!plans.some(p => p.planId === a)) setA(plans[0]?.planId ?? "");
    if (!plans.some(p => p.planId === b)) setB(plans[1]?.planId ?? "");
  }, [plans, a, b]);
  const left = plans.find(p => p.planId === a), right = plans.find(p => p.planId === b);
  const canCompare = !!left && !!right && a !== b;
  const result = canCompare && compared === `${a}:${b}` ? comparePlans(left, right) : null;
  const name = (id: string) => left?.savedEvaluation.cards.find(c => c.offeringId === id)?.title ?? right?.savedEvaluation.cards.find(c => c.offeringId === id)?.title ?? id;
  return <section className={s.panel}><h2>저장 계획 비교</h2>{plans.length < 2 && <p>계획을 두 개 이상 저장하면 비교할 수 있어요.</p>}
    <div className={s.roadmapHeader}><label>첫 계획<select value={a} onChange={e => { setA(e.target.value); setCompared(null); }}>{plans.map(p => <option value={p.planId} key={p.planId}>{p.name}</option>)}</select></label><label>둘째 계획<select value={b} onChange={e => { setB(e.target.value); setCompared(null); }}>{plans.map(p => <option value={p.planId} key={p.planId}>{p.name}</option>)}</select></label><button disabled={!canCompare} className={s.primaryButton} onClick={() => setCompared(`${a}:${b}`)}>계획 비교</button></div>
    {result && <table className={s.compareTable}><thead><tr><th>구분</th><th>회차</th></tr></thead><tbody>{([ ["첫 계획에만", result.onlyA], ["둘째 계획에만", result.onlyB], ["공통", result.both], ["시점 변경", result.moved] ] as const).map(([label, ids]) => <tr key={label}><th>{label}</th><td>{ids.map(name).join(", ") || "없음"}</td></tr>)}</tbody></table>}
  </section>;
}
