import { describe, expect, it } from 'vitest';
import { pourProgress, toPours, toSteps } from '../pours';

const steps = [
  { waterG: 60, atSec: 0 },
  { waterG: 100, atSec: 45 },
  { waterG: 100, atSec: 90 },
];

describe('注湯スケジュール', () => {
  it('各投の注湯量を累積目標重量に変換する', () => {
    expect(toPours(steps).map((pour) => pour.targetG)).toEqual([60, 160, 260]);
  });

  it('累積目標重量から各投の注湯量へ往復できる', () => {
    expect(toSteps(toPours(steps))).toEqual(steps);
  });

  it('経過秒から現在と次の投を求める', () => {
    const pours = toPours(steps);
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
