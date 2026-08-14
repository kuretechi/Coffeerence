import { Banner, Card } from '../ui/components';

/** 実装前の画面。タブだけ先に用意しておく。 */
export function ComingSoonScreen({ title, description }: { title: string; description: string }) {
  return (
    <Card title={title} hint={description}>
      <Banner>開発中です。</Banner>
    </Card>
  );
}
