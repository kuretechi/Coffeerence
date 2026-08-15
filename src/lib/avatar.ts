/** プロフィール画像は正方形に切り出して縮小し、data URL として保存する。 */
const AVATAR_SIZE = 128;
const AVATAR_QUALITY = 0.8;

export const AVATAR_MAX_BYTES = 300_000;

/** 画像ファイルを 128px 角の JPEG data URL にする。 */
export async function toAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('画像ファイルを選んでください。');
  if (file.size > 10_000_000) throw new Error('画像が大きすぎます（10MB まで）。');

  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('画像を変換できませんでした。');

    // 中央を正方形に切り出してから縮小する。
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    context.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

    const dataUrl = canvas.toDataURL('image/jpeg', AVATAR_QUALITY);
    if (dataUrl.length > AVATAR_MAX_BYTES) throw new Error('画像を小さくできませんでした。別の画像を選んでください。');
    return dataUrl;
  } finally {
    bitmap.close();
  }
}
