import { expect, test } from "vitest";
import { matchesSearch } from "@/lib/planner/search";
import { createStarStore, STAR_KEY } from "@/lib/planner/stars";
import type { Card } from "@/lib/planner/types";
const card = { title: "청년 월세 지원", org: "인천 시청", support: "최대 (20)만원", summary: "" } as Card;
class StorageMemory { data = new Map<string,string>(); get length(){return this.data.size} key(i:number){return [...this.data.keys()][i]??null} getItem(k:string){return this.data.get(k)??null} setItem(k:string,v:string){this.data.set(k,v)} removeItem(k:string){this.data.delete(k)} clear(){this.data.clear()} }
test("search ignores whitespace and case, treats special characters literally",()=>{expect(matchesSearch(card,"  ")).toBe(true);expect(matchesSearch(card,"청년월세")).toBe(true);expect(matchesSearch(card,"인천 시 청")).toBe(true);expect(matchesSearch(card,"(20)")).toBe(true);expect(matchesSearch(card,"[")).toBe(false)});
test("stars persist by policy and recover from malformed storage",()=>{const storage=new StorageMemory();const store=createStarStore(storage);expect(store.toggle("p1")).toBe(true);expect(createStarStore(storage).has("p1")).toBe(true);expect(store.toggle("p1")).toBe(false);storage.setItem(STAR_KEY,"bad");expect(createStarStore(storage).list()).toEqual([])});
test("stars remain usable in memory when browser storage fails",()=>{const storage=new StorageMemory();storage.setItem=()=>{throw new Error("quota")};const store=createStarStore(storage);expect(store.toggle("p1")).toBe(true);expect(store.has("p1")).toBe(true);expect(store.toggle("p1")).toBe(false)});
