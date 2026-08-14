import { describe, expect, it } from 'vitest';
import { pourProgress, toSteps } from '../pours';

const pours = [
  { index: 1, targetG: 60, startSec: 0 },
  { index: 2, targetG: 160, startSec: 45 },
  { index: 3, targetG: 260, startSec: 90 },
];

describe('注湯スケジュール', () => {
  it('累積目標重量から各投の注湯量を復元する', () => {
    expect(toSteps(pours)).toEqual([
      { waterG: 60, atSec: 0 },
      { waterG: 100, atSec: 45 },
      { waterG: 100, atSec: 90 },
    ]);
  });

  it('経過秒から現在と次の投を求める', () => {
    const before = pourProgress(pours, 30);
    expect(before.current?.index).toBe(1);
    expect(before.next?.index).toBe(2);
    expect(before.untilNextSec).toBe(15);

    const after = pourProgress(pours, 120);
    expect(after.current?.index).toBe(3);
    expect(after.next).toBeUndefined();
    expect(after.sinceCurrentSec).toBe(30);
  });
});
