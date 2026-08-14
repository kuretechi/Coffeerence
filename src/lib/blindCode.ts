import { type Rng, defaultRng } from './random';

// R-3: コード体系に規則性を持たせない。母音を含めず、意味のある3文字を避ける。
const LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';

export function generateBlindCode(existing: ReadonlySet<string>, rng: Rng = defaultRng): string {
  for (let attempt = 0; attempt < 500; attempt++) {
    let code = '';
    for (let i = 0; i < 3; i++) code += LETTERS[Math.floor(rng() * LETTERS.length)];
    if (!existing.has(code)) return code;
  }
  throw new Error('ブラインドコードを生成できませんでした');
}

export function generateBlindCodes(count: number, rng: Rng = defaultRng): string[] {
  const used = new Set<string>();
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = generateBlindCode(used, rng);
    used.add(code);
    codes.push(code);
  }
  return codes;
}
