// Normalize the inline formats supported by call_api.py, plus one pair per line.
export function parseGlossary(value?: string): string[] {
  const input = (value || '').trim();
  if (!input) return [];
  const terms = new Map<string, string>();
  const invalid: (message: string) => never = (message) => {
    throw { type: 'param', message: `术语对照表：${message}` };
  };
  const add = (source: string, target: string) => {
    source = source.trim();
    target = target.trim();
    if (!source || !target) invalid('原词和译词均不能为空');
    if (/[\r\n]/.test(source + target)) invalid('单个原词或译词不能包含换行');
    const previous = terms.get(source);
    if (previous !== undefined && previous !== target) invalid(`原词「${source}」存在不同译词`);
    terms.set(source, target);
  };

  if (input.startsWith('{') || input.startsWith('[')) {
    let data: unknown;
    try { data = JSON.parse(input); } catch { invalid('JSON 格式无效，请使用 {"原词":"译词"}'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) invalid('JSON 必须是原词到译词的对象');
    for (const [source, target] of Object.entries(data as Record<string, unknown>)) {
      if (typeof target !== 'string') invalid(`「${source}」的译词必须是字符串`);
      add(source, target);
    }
  } else {
    const pairs = input.split(/[,，\r\n]+/).map((pair) => pair.trim()).filter(Boolean);
    if (!pairs.length) invalid('没有有效的术语对照');
    for (const pair of pairs) {
      const separator = ['->', '→', ':', '：'].find((item) => pair.includes(item));
      if (!separator) invalid(`「${pair}」缺少分隔符，请使用 原词:译词`);
      const index = pair.indexOf(separator);
      add(pair.slice(0, index), pair.slice(index + separator.length));
    }
  }
  return Array.from(terms, ([source, target]) => `${source}→${target}`);
}
