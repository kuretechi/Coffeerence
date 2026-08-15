import { describe, expect, it } from 'vitest';
import { calibrate, type CalibrationPoint } from '../calibration';

describe('calibrate', () => {
  it('完全に直線上の3点なら傾き・切片・R²=1 を厳密に復元する', () => {
    // θ=-1,0,1 / 外部=80,82,84 → 大会スコア = 2θ + 82
    const points: CalibrationPoint[] = [
      { theta: -1, externalScore: 80 },
      { theta: 0, externalScore: 82 },
      { theta: 1, externalScore: 84 },
    ];
    const result = calibrate(points);
    expect(result.calibrated).toBe(true);
    expect(result.n).toBe(3);
    expect(result.slope).toBeCloseTo(2, 12);
    expect(result.intercept).toBeCloseTo(82, 12);
    expect(result.r2).toBeCloseTo(1, 12);
    const prediction = result.predict(2);
    expect(prediction.estimate).toBeCloseTo(86, 12);
    // 残差ゼロなので予測区間の幅もゼロ。
    expect(prediction.piHigh - prediction.piLow).toBeCloseTo(0, 12);
  });

  it('手計算できるデータで最小二乗解と予測区間を再現する', () => {
    // θ=0,1,2 / 外部=1,3,2 → θ̄=1, ȳ=2, Sxx=2, Sxy=1, Syy=2
    //   slope=0.5, intercept=1.5, SSres=1.5, R²=0.25, s=√1.5
    const result = calibrate([
      { theta: 0, externalScore: 1 },
      { theta: 1, externalScore: 3 },
      { theta: 2, externalScore: 2 },
    ]);
    expect(result.slope).toBeCloseTo(0.5, 12);
    expect(result.intercept).toBeCloseTo(1.5, 12);
    expect(result.r2).toBeCloseTo(0.25, 12);

    // 予測区間: ŷ ± 1.959964·√1.5·√(1 + 1/3 + (θ−1)²/2)（python で検算）
    const atMean = result.predict(1);
    expect(atMean.estimate).toBeCloseTo(2, 12);
    expect(atMean.piHigh - atMean.estimate).toBeCloseTo(2.771807648699354, 6);
    expect(atMean.estimate - atMean.piLow).toBeCloseTo(2.771807648699354, 6);

    const atTwo = result.predict(2);
    expect(atTwo.estimate).toBeCloseTo(2.5, 12);
    expect(atTwo.piHigh - atTwo.estimate).toBeCloseTo(3.250232569664644, 6);
    // 平均から離れるほど区間は広い。
    expect(atTwo.piHigh - atTwo.piLow).toBeGreaterThan(atMean.piHigh - atMean.piLow);
  });

  it('自己採点があればバイアス（自己 − 外部）の平均を返す', () => {
    const result = calibrate([
      { theta: -1, externalScore: 80, selfScore: 82 },
      { theta: 0, externalScore: 82, selfScore: 85 },
      { theta: 1, externalScore: 84, selfScore: 88 },
    ]);
    expect(result.selfBias).toBeCloseTo(3, 12); // (2+3+4)/3
  });

  it('自己採点が一部だけなら、ある点のみで平均する', () => {
    const result = calibrate([
      { theta: -1, externalScore: 80, selfScore: 81 },
      { theta: 0, externalScore: 82 },
      { theta: 1, externalScore: 84, selfScore: 87 },
    ]);
    expect(result.selfBias).toBeCloseTo(2, 12); // (1+3)/2
  });

  it('自己採点が無ければ selfBias は undefined', () => {
    const result = calibrate([
      { theta: -1, externalScore: 80 },
      { theta: 0, externalScore: 82 },
      { theta: 1, externalScore: 84 },
    ]);
    expect(result.selfBias).toBeUndefined();
  });

  it('点が minPoints 未満なら calibrated=false で predict は NaN 区間', () => {
    for (const points of [
      [] as CalibrationPoint[],
      [{ theta: 0, externalScore: 82 }],
      [
        { theta: 0, externalScore: 82 },
        { theta: 1, externalScore: 84 },
      ],
    ]) {
      const result = calibrate(points);
      expect(result.calibrated).toBe(false);
      expect(result.n).toBe(points.length);
      expect(result.slope).toBeNaN();
      expect(result.intercept).toBeNaN();
      expect(result.r2).toBeNaN();
      const prediction = result.predict(0.5);
      expect(prediction.estimate).toBeNaN();
      expect(prediction.piLow).toBeNaN();
      expect(prediction.piHigh).toBeNaN();
    }
  });

  it('minPoints を上げれば足りない扱いになるが selfBias は返す', () => {
    const points: CalibrationPoint[] = [
      { theta: -1, externalScore: 80, selfScore: 81 },
      { theta: 0, externalScore: 82, selfScore: 83 },
      { theta: 1, externalScore: 84, selfScore: 85 },
    ];
    const result = calibrate(points, { minPoints: 5 });
    expect(result.calibrated).toBe(false);
    expect(result.selfBias).toBeCloseTo(1, 12);
  });

  it('θ が全て同一値なら傾きが定義できないので calibrated=false', () => {
    const result = calibrate([
      { theta: 1, externalScore: 80 },
      { theta: 1, externalScore: 82 },
      { theta: 1, externalScore: 84 },
    ]);
    expect(result.calibrated).toBe(false);
    expect(result.slope).toBeNaN();
    expect(result.predict(1).piHigh).toBeNaN();
  });

  it('外部採点が全て同一値なら傾き0・完全適合として扱う', () => {
    const result = calibrate([
      { theta: 0, externalScore: 82 },
      { theta: 1, externalScore: 82 },
      { theta: 2, externalScore: 82 },
    ]);
    expect(result.calibrated).toBe(true);
    expect(result.slope).toBeCloseTo(0, 12);
    expect(result.intercept).toBeCloseTo(82, 12);
    expect(result.r2).toBeCloseTo(1, 12);
    expect(result.predict(5).estimate).toBeCloseTo(82, 12);
  });

  it('R² は 0..1 に収まる', () => {
    const result = calibrate([
      { theta: 0, externalScore: 80 },
      { theta: 1, externalScore: 79 },
      { theta: 2, externalScore: 85 },
      { theta: 3, externalScore: 83 },
    ]);
    expect(result.r2).toBeGreaterThanOrEqual(0);
    expect(result.r2).toBeLessThanOrEqual(1);
  });

  it('尺度変換に対して整合する（θ を 100 倍しても予測値は同じ）', () => {
    const base: CalibrationPoint[] = [
      { theta: 0, externalScore: 80 },
      { theta: 1, externalScore: 83 },
      { theta: 2, externalScore: 84 },
    ];
    const scaled = base.map((point) => ({ ...point, theta: point.theta * 100 }));
    const a = calibrate(base).predict(1.5);
    const b = calibrate(scaled).predict(150);
    expect(b.estimate).toBeCloseTo(a.estimate, 8);
    expect(b.piLow).toBeCloseTo(a.piLow, 8);
    expect(b.piHigh).toBeCloseTo(a.piHigh, 8);
  });

  it('極端に大きい値でも有限の結果を返す', () => {
    const result = calibrate([
      { theta: 0, externalScore: 1e9 },
      { theta: 1e6, externalScore: 2e9 },
      { theta: 2e6, externalScore: 3e9 },
    ]);
    expect(result.calibrated).toBe(true);
    expect(result.slope).toBeCloseTo(1000, 6);
    expect(Number.isFinite(result.predict(1e6).estimate)).toBe(true);
  });

  it('NaN / Infinity は例外', () => {
    const ok: CalibrationPoint[] = [
      { theta: 0, externalScore: 80 },
      { theta: 1, externalScore: 82 },
      { theta: 2, externalScore: 84 },
    ];
    expect(() => calibrate([...ok, { theta: NaN, externalScore: 80 }])).toThrow();
    expect(() => calibrate([...ok, { theta: 3, externalScore: Infinity }])).toThrow();
    expect(() => calibrate([...ok, { theta: 3, externalScore: 85, selfScore: NaN }])).toThrow();
    expect(() => calibrate(ok).predict(NaN)).toThrow();
    expect(() => calibrate(ok, { minPoints: 2 })).toThrow();
    expect(() => calibrate(ok, { minPoints: 3.5 })).toThrow();
  });

  it('同じ入力なら結果が完全に一致する（決定論）', () => {
    const points: CalibrationPoint[] = [
      { theta: 0, externalScore: 80, selfScore: 82 },
      { theta: 1, externalScore: 83 },
      { theta: 2, externalScore: 84 },
    ];
    const a = calibrate(points);
    const b = calibrate(points);
    expect(a.slope).toBe(b.slope);
    expect(a.intercept).toBe(b.intercept);
    expect(a.r2).toBe(b.r2);
    expect(a.predict(1.5)).toEqual(b.predict(1.5));
  });

  it('入力配列を書き換えない', () => {
    const points: CalibrationPoint[] = [
      { theta: 0, externalScore: 80, selfScore: 82 },
      { theta: 1, externalScore: 83 },
      { theta: 2, externalScore: 84 },
    ];
    const snapshot = JSON.stringify(points);
    calibrate(points);
    expect(JSON.stringify(points)).toBe(snapshot);
  });
});
