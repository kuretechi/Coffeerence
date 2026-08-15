import type { ModerationSettings, ModerationVerdict } from '../domain/types';

/**
 * 投稿の不適切判定。
 * 既定はオフラインで動くローカル判定。設定でAPIキーを入れると外部モデルに切り替わり、
 * 呼び出しに失敗したときはローカル判定にフォールバックする。
 */

interface Rule {
  category: string;
  label: string;
  pattern: RegExp;
}

// 語彙は最小限にとどめ、運用しながら設定側で足せるようにしている。
const RULES: Rule[] = [
  {
    category: 'violence',
    label: '暴力・脅迫',
    pattern: /(殺す|殺害|死ね|しね|ぶっ殺|刺す|kill you|i'?ll kill)/i,
  },
  {
    category: 'harassment',
    label: '侮辱・嫌がらせ',
    pattern: /(死ねばいい|クズ|カス野郎|バカ野郎|アホ死|きもい|キモい|ブス|デブ|fuck you|idiot|moron)/i,
  },
  {
    category: 'sexual',
    label: '性的表現',
    pattern: /(セックス|セフレ|エロ画像|裸(?:の)?画像|ポルノ|porn|nude)/i,
  },
  {
    category: 'discrimination',
    label: '差別',
    pattern: /(差別的|土人|劣等民族|nigger|retard)/i,
  },
  {
    category: 'self_harm',
    label: '自傷',
    pattern: /(自殺(?:したい|方法)|首を吊|リストカット|suicide method)/i,
  },
  {
    category: 'spam',
    label: 'スパム・勧誘',
    pattern: /(https?:\/\/\S+\s*){3,}|(儲かる|副業で稼|必ず稼げる|投資で稼|出会い系)/i,
  },
];

const ALLOWED: ModerationVerdict = { allowed: true, categories: [], provider: 'local' };

/** 端末内だけで完結する規則ベースの判定。 */
export function moderateLocally(text: string, extraWords: readonly string[] = []): ModerationVerdict {
  const categories = RULES.filter((rule) => rule.pattern.test(text));
  const hitWords = extraWords.filter((word) => word.trim() !== '' && text.includes(word.trim()));
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
async function moderateRemotely(text: string, settings: ModerationSettings): Promise<ModerationVerdict> {
  const response = await fetch(settings.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({ model: settings.model, input: text }),
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
 * 投稿本文を判定する。外部モデルが使えないときはローカル判定の結果を返すので、
 * オフラインでも判定機構そのものは必ず働く。
 */
export async function moderate(text: string, settings: ModerationSettings): Promise<ModerationVerdict> {
  const local = moderateLocally(text, settings.blocklist);
  if (!local.allowed) return local;
  if (settings.provider !== 'remote' || settings.apiKey.trim() === '') return local;
  try {
    return await moderateRemotely(text, settings);
  } catch {
    // 判定できないときは投稿を止めず、ローカル判定の結果に従う。
    return { ...local, provider: 'local' };
  }
}
