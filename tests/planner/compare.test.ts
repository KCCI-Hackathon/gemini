import { expect, test } from "vitest";
import { comparePlans } from "@/lib/planner/compare";
import type { SavedPlan } from "@/lib/planner/types";
const plan=(choices:{offeringId:string;stageId:string}[])=>({input:{choices}} as SavedPlan);
test("offering comparison separates unique, shared and moved stages",()=>{expect(comparePlans(plan([{offeringId:"x",stageId:"current"},{offeringId:"y",stageId:"current"}]),plan([{offeringId:"y",stageId:"ev-course"},{offeringId:"z",stageId:"current"}]))).toEqual({onlyA:["x"],onlyB:["z"],both:["y"],moved:["y"]})});
