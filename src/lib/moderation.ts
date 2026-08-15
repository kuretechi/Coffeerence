import type { ModerationVerdict } from '../domain/types';

/**
 * 投稿の不適切判定。アプリ側で必ず実行するもので、利用者は設定も無効化もできない。
 * 本判定は自然言語処理モデル（OpenAI 互換 moderation）で行い、語彙による規則判定は
 * モデルに到達できないとき（オフライン・プロキシ停止）の保険としてだけ使う。
 *
 * API キーは静的サイトに置けないので、鍵を持つプロキシ（proxy/moderation-worker.js）の
 * URL をビルド時に VITE_MODERATION_ENDPOINT で渡す。VITE_MODERATION_API_KEY は
 * ローカル検証で直接 OpenAI を叩くときだけ使う。
 */

const REMOTE = {
  endpoint: import.meta.env.VITE_MODERATION_ENDPOINT ?? '',
  model: import.meta.env.VITE_MODERATION_MODEL ?? 'omni-moderation-latest',
  apiKey: import.meta.env.VITE_MODERATION_API_KEY ?? '',
};

interface Rule {
  category: string;
  label: string;
  pattern: RegExp;
}

// 語彙は運用しながら足していく。パターンは正規化後（全角・カタカナ・空白・記号を落とした形）の文字列に当てる。
const RULES: Rule[] = [
  {
    category: 'violence',
    label: '暴力・脅迫',
    pattern:
      /(殺す|殺して|殺され|殺害|殺人|ころす|ころして|ころされ|死ね|しね|死んで|しんで|ぶっころ|ぶっ殺|殴り殺|なぐりころ|刺し殺|やってやる|killyou|illkill|murder)/,
  },
  {
    category: 'harassment',
    label: '侮辱・嫌がらせ',
    pattern:
      /(くず(?!れ|こ|もち|ゆ)|クズ|かす野郎|かすやろう|ばか(?!り)|馬鹿|あほ|阿呆|まぬけ|間抜け|むのう|無能|きもい|ぶす(?!う)|でぶ|うざい|うっとうしい|きちがい|いじめ|嫌がらせ|いやがらせ|fuck|fck|fuk|fvck|shit|bitch|asshole|idiot|moron|stupid|loser)/,
  },
  {
    category: 'sexual',
    label: '性的表現',
    pattern: /(せっくす|せふれ|えろい|えろがぞう|えろどうが|はだかがぞう|裸画像|ぽるの|ふうぞく|えっち|ちんこ|まんこ|porn|nude|sex)/,
  },
  {
    category: 'discrimination',
    label: '差別',
    pattern: /(どじん|土人|劣等民族|れっとうみんぞく|差別的|さべつてき|めくら|つんぼ|nigger|retard)/,
  },
  {
    category: 'self_harm',
    label: '自傷',
    pattern: /(自殺|じさつ|首を吊|くびをつ|くびつり|りすとかっと|おばどず|suicide|killmyself)/,
  },
  {
    category: 'vulgar',
    label: '下品な表現',
    pattern: /(うんち|うんこ|うんk|くそったれ|クソ野郎|くそやろう|ちんちん|しょんべん|げろ|おなら|poop|crap|piss)/,
  },
  {
    category: 'spam',
    label: 'スパム・勧誘',
    pattern: /(儲かる|もうかる|副業で稼|ふくぎょうでかせ|必ず稼げる|かならずかせげる|投資で稼|とうしでかせ|出会い系|であいけい|初回無料|しょかいむりょう)/,
  },
];

const ALLOWED: ModerationVerdict = { allowed: true, categories: [], provider: 'local' };

const URL_PATTERN = /https?:\/\/\S+/g;

/**
 * 判定をすり抜けにくくするための正規化。全角を半角に、カタカナをひらがなに寄せ、
 * 空白・記号・長音・連続する同じ文字を落とす（例:「ｼ　ﾈ★」→「しね」）。
 */
function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .replace(/[\s\p{P}\p{S}\u30fc\u309b\u309c]/gu, '')
    .replace(/(.)\1{2,}/gu, '$1');
}

/** 端末内だけで完結する規則ベースの判定。 */
export function moderateLocally(text: string, extraWords: readonly string[] = []): ModerationVerdict {
  const normalized = normalize(text);
  const categories = RULES.filter((rule) => rule.pattern.test(normalized));
  const spamRule = RULES.find((rule) => rule.category === 'spam');
  if (spamRule && !categories.includes(spamRule) && (text.match(URL_PATTERN) ?? []).length >= 3) {
    categories.push(spamRule);
  }
  const hitWords = extraWords.filter((word) => word.trim() !== '' && normalized.includes(normalize(word)));
  if (categories.length === 0 && hitWords.length === 0) return ALLOWED;
  const labels = [...categories.map((rule) => rule.label), ...(hitWords.length > 0 ? ['NGワード'] : [])];
  return {
    allowed: false,
    categories: [...categories.map((rule) => rule.category), ...(hitWords.length > 0 ? ['blocklist'] : [])],
    reason: `${labels.join(' / ')}に該当する表現が含まれています。`,
    provider: 'local',
  };
}

interface OpenAiModerationResponse {
  results?: { flagged: boolean; categories: Record<string, boolean> }[];
}

/** OpenAI 互換の moderation エンドポイントに問い合わせる。 */
async function moderateRemotely(text: string): Promise<ModerationVerdict> {
  const response = await fetch(REMOTE.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // プロキシ経由のときは鍵を持たないので Authorization は付けない。
      ...(REMOTE.apiKey === '' ? {} : { Authorization: `Bearer ${REMOTE.apiKey}` }),
    },
    body: JSON.stringify({ model: REMOTE.model, input: text }),
  });
  if (!response.ok) throw new Error(`moderation API ${response.status}`);
  const body: OpenAiModerationResponse = await response.json();
  const result = body.results?.[0];
  if (!result) throw new Error('moderation API に results がありません');
  const categories = Object.entries(result.categories ?? {})
    .filter(([, hit]) => hit)
    .map(([name]) => name);
  return result.flagged
    ? {
        allowed: false,
        categories,
        reason: `AI判定で不適切（${categories.join(', ') || 'flagged'}）と判断されました。`,
        provider: 'remote',
      }
    : { allowed: true, categories: [], provider: 'remote' };
}

/**
 * 投稿本文を判定する。モデル判定を本線とし、到達できないときだけ規則判定に落ちる。
 * 規則判定が先に弾いた分は明らかな表現なので、モデルに投げずにその場で拒否する。
 */
export async function moderate(text: string): Promise<ModerationVerdict> {
  const local = moderateLocally(text);
  if (!local.allowed) return local;
  if (REMOTE.endpoint === '') return local;
  try {
    return await moderateRemotely(text);
  } catch {
    // 判定できないときは投稿を止めず、規則判定の結果に従う。
    return { ...local, provider: 'local' };
  }
}
