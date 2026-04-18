import type { FileItem } from '@/types';

/**
 * 소방공무원 계급 (높은 순)
 * 주의: 정규식/검색 시 긴 문자열부터 매칭해야 오탐 방지됨.
 * 예) "소방사시보"가 "소방사"보다 먼저, "소방정감"이 "소방정"보다 먼저.
 */
export const FIRE_RANKS: string[] = [
  '소방총감',
  '소방정감',
  '소방감',
  '소방준감',
  '소방정',
  '소방령',
  '소방경',
  '소방위',
  '소방장',
  '소방교',
  '소방사시보',
  '소방사',
];

// 매칭 우선순위가 높은 (=길고 구체적인) 계급을 앞에 둔 정규식.
const RANK_REGEX = /소방사시보|소방총감|소방정감|소방준감|소방사|소방교|소방장|소방위|소방경|소방령|소방정|소방감/;

// 정렬 가중치: 계급이 높을수록 작은 숫자.
const RANK_WEIGHT: Record<string, number> = FIRE_RANKS.reduce(
  (acc, rank, idx) => {
    acc[rank] = idx;
    return acc;
  },
  {} as Record<string, number>,
);

export function extractRank(filename: string): string | null {
  if (!filename) return null;
  const m = filename.match(RANK_REGEX);
  return m ? m[0] : null;
}

function getWeight(name: string): number {
  const r = extractRank(name);
  // 계급 없으면 맨 뒤로.
  return r == null ? Number.POSITIVE_INFINITY : RANK_WEIGHT[r];
}

export function sortByRank(
  files: FileItem[],
  order: 'high' | 'low',
): FileItem[] {
  const arr = files.slice();
  arr.sort((a, b) => {
    const wa = getWeight(a.name);
    const wb = getWeight(b.name);

    if (wa !== wb) {
      // high: 가중치 작은(=계급 높은) 것부터. low: 반대.
      return order === 'high' ? wa - wb : wb - wa;
    }

    // 같은 계급이거나 둘 다 계급 없음 → 파일명 가나다순.
    return a.name.localeCompare(b.name, 'ko');
  });
  return arr;
}

export function sortByName(
  files: FileItem[],
  order: 'asc' | 'desc',
): FileItem[] {
  const arr = files.slice();
  arr.sort((a, b) => {
    const cmp = a.name.localeCompare(b.name, 'ko');
    return order === 'asc' ? cmp : -cmp;
  });
  return arr;
}
