import type { Gender } from '../domain/types';

export const GENDERS: { value: Gender | 'unset'; label: string }[] = [
  { value: 'unset', label: '未回答' },
  { value: 'male', label: '男性' },
  { value: 'female', label: '女性' },
  { value: 'other', label: 'その他' },
];

/** 性別の表示名。未設定は「未回答」。 */
export function genderLabel(gender: Gender | undefined): string {
  return GENDERS.find((item) => item.value === gender)?.label ?? '未回答';
}
