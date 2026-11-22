import { expect, test } from "vitest";
import { scrubPII } from "@/lib/planner/counsel-target";

const X = "[개인정보]";

test("상세 주소(번지 · 도로명 · 동호수)는 지운다", () => {
  expect(scrubPII("수원시 영통구 매탄동 123번지 살아요").text).toBe(`수원시 영통구 ${X} 살아요`);
  expect(scrubPII("매탄동 123-4 살아요").text).toBe(`${X} 살아요`);
  expect(scrubPII("월드컵로 120에 살아요").text).toBe(`${X}에 살아요`);
  expect(scrubPII("중앙로12번길 34-1 이에요").text).toBe(`${X} 이에요`);
  expect(scrubPII("101동 1203호 살아요").text).toBe(`${X} 살아요`);
  expect(scrubPII("매탄동 123번지 살아요").redacted).toBe(true);
});

test("주소가 아닌 숫자 표현은 그대로 둔다", () => {
  for (const t of ["앞으로 3개월 뒤 취업해요", "새로 2개 담았어요", "추가 200만원 받아요", "수원시 영통구로 이사해요", "매탄동으로 이사해요", "12월 19일 수료", "2호선 타요", "앞으로 12개월"]) {
    expect(scrubPII(t)).toEqual({ text: t, redacted: false });
  }
});

test("스스로 밝힌 이름은 지운다", () => {
  expect(scrubPII("저는 이도윤이고 이사 예정이에요").text).toBe(`저는 ${X}이고 이사 예정이에요`);
  expect(scrubPII("제 이름은 박서연이에요").text).toBe(`제 이름은 ${X}이에요`);
  expect(scrubPII("김민준입니다. 질문 있어요").text).toBe(`${X}입니다. 질문 있어요`);
  expect(scrubPII("최지우라고 해요").text).toBe(`${X}라고 해요`);
});

test("상태를 말한 문장은 이름으로 보지 않는다", () => {
  for (const t of ["저는 대학생이고 휴학 중이에요", "저는 장애인이고 취업 준비해요", "저는 한부모예요", "저는 구직자입니다", "저는 정규직이에요", "저는 신입생이에요", "저는 고졸이고 무직이에요", "저는 차상위입니다", "저는 유학생이에요"]) {
    expect(scrubPII(t)).toEqual({ text: t, redacted: false });
  }
});
