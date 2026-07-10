/**
 * 词项高亮工具：在文本中标记倒排索引的词项位置，合并重叠区间后生成高亮 HTML。
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function findAllOccurrences(textLower: string, term: string): [number, number][] {
  const ranges: [number, number][] = [];
  let pos = 0;
  while (pos < textLower.length) {
    const idx = textLower.indexOf(term, pos);
    if (idx === -1) break;
    ranges.push([idx, idx + term.length]);
    pos = idx + 1;
  }
  return ranges;
}

function mergeRanges(ranges: [number, number][]): [number, number][] {
  if (ranges.length === 0) return [];
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    if (ranges[i][0] <= last[1]) {
      last[1] = Math.max(last[1], ranges[i][1]);
    } else {
      merged.push(ranges[i]);
    }
  }
  return merged;
}

export function highlightTerms(text: string, terms: string[]): string {
  if (!terms.length || !text) return escapeHtml(text);

  const textLower = text.toLowerCase();
  const allRanges: [number, number][] = [];

  for (const term of terms) {
    const termLower = term.toLowerCase();
    for (const range of findAllOccurrences(textLower, termLower)) {
      allRanges.push(range);
    }
  }

  const merged = mergeRanges(allRanges);
  if (merged.length === 0) return escapeHtml(text);

  let result = '';
  let lastEnd = 0;
  for (const [start, end] of merged) {
    if (start > lastEnd) {
      result += escapeHtml(text.slice(lastEnd, start));
    }
    result += '<mark class="indexed-term">' + escapeHtml(text.slice(start, end)) + '</mark>';
    lastEnd = end;
  }
  if (lastEnd < text.length) {
    result += escapeHtml(text.slice(lastEnd));
  }

  return result;
}
