/** 入力に NaN / Infinity が混ざっていれば例外を投げる。 */
export function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
}

/**
 * 標準正規分布の累積分布関数 Φ(z)。
 * Cody 系の有理近似（erfc ベース）で絶対誤差は 1e-15 程度。
 */
export function normalCdf(z: number): number {
  assertFinite(z, 'z');
  return 0.5 * erfc(-z / Math.SQRT2);
}

/** 相補誤差関数 erfc(x)。連分数/有理近似で高精度に計算する。 */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 2 / (2 + z);
  const y = 4 * t - 2;
  // Chebyshev 係数（Numerical Recipes erfccheb）
  const cof = [
    -1.3026537197817094, 6.4196979235649026e-1, 1.9476473204185836e-2, -9.561514786808631e-3, -9.46595344482036e-4,
    3.66839497852761e-4, 4.2523324806907e-5, -2.0278578112534e-5, -1.624290004647e-6, 1.303655835580e-6,
    1.5626441722e-8, -8.5238095915e-8, 6.529054439e-9, 5.059343495e-9, -9.91364156e-10, -2.27365122e-10,
    9.6467911e-11, 2.394038e-12, -6.886027e-12, 8.94487e-13, 3.13092e-13, -1.12708e-13, 3.81e-16, 7.106e-15,
  ];
  let d = 0;
  let dd = 0;
  for (let j = cof.length - 1; j > 0; j -= 1) {
    const tmp = d;
    d = y * d - dd + cof[j];
    dd = tmp;
  }
  const ans = t * Math.exp(-z * z + 0.5 * (cof[0] + y * d) - dd);
  return x >= 0 ? ans : 2 - ans;
}

/** 標準正規分布の分位点 Φ⁻¹(p)。Acklam の有理近似＋1回のニュートン補正。 */
export function normalInvCdf(p: number): number {
  assertFinite(p, 'p');
  if (p <= 0 || p >= 1) throw new Error('p must be in (0, 1)');
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  let x: number;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pLow) {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  // ニュートン法で1段だけ磨く。φ(x) が極端に小さい裾では補正しない。
  const pdf = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  if (pdf > 1e-300) x -= (normalCdf(x) - p) / pdf;
  return x;
}
