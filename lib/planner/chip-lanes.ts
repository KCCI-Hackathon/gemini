// 내 일정 띠의 칩(현재 · 수료 · 취업 등)을 겹치지 않게 줄에 나눈다.
// 칩은 날짜 위치에서 오른쪽으로 펼쳐지므로, 앞 칩의 오른쪽 끝보다 왼쪽에서 시작하면 다음 줄로 내린다.
export type ChipBox = { id: string; x: number; width: number };

/** 각 칩의 줄 번호(0부터). 위 줄부터 채운다. x · width 는 같은 단위(px)여야 한다. */
export function chipLanes(chips: ChipBox[], gap = 8): Map<string, number> {
  const ends: number[] = [];
  const lanes = new Map<string, number>();
  for (const chip of [...chips].sort((a, b) => a.x - b.x || a.id.localeCompare(b.id))) {
    let lane = ends.findIndex(end => end + gap <= chip.x);
    if (lane < 0) lane = ends.length;
    ends[lane] = chip.x + chip.width;
    lanes.set(chip.id, lane);
  }
  return lanes;
}
