import { useEffect, useMemo, useState } from 'react';
import { Banner, Card, Pill, formatSeconds } from '../ui/components';
import { useCompetition, useRehearsals, useSettings } from '../ui/data';
import { beep, useStopwatch, useWakeLock } from '../ui/useTimer';
import { saveRehearsal } from '../db/repo';
import { uid } from '../lib/random';
import type { RehearsalPhase, RehearsalRecord } from '../domain/types';

const PHASE_LABEL: Record<RehearsalPhase, string> = {
  idle: '待機',
  prep: '準備',
  brew: '競技',
  judge: '審査',
  done: '終了',
};

export function RehearsalScreen() {
  const competition = useCompetition();
  const settings = useSettings();
  const rehearsals = useRehearsals();
  const stopwatch = useStopwatch();
  const [phase, setPhase] = useState<RehearsalPhase>('idle');
  const [marks, setMarks] = useState<RehearsalRecord['marks']>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [actuals, setActuals] = useState<{ prep: number; brew: number; judge: number }>({ prep: 0, brew: 0, judge: 0 });

  useWakeLock(phase !== 'idle' && phase !== 'done');

  const limit = useMemo(() => {
    if (phase === 'prep') return competition.prepSeconds;
    if (phase === 'brew') return competition.brewSeconds;
    if (phase === 'judge') return competition.judgeSeconds;
    return 0;
  }, [phase, competition]);

  const remaining = limit - stopwatch.elapsed;

  useEffect(() => {
    if (phase === 'idle' || phase === 'done') return;
    if (remaining > 0) return;
    const elapsed = Math.round(stopwatch.elapsed);
    beep(settings.soundEnabled, 880, 400);
    if (phase === 'prep') {
      setActuals((a) => ({ ...a, prep: elapsed }));
      setPhase('brew');
    } else if (phase === 'brew') {
      setActuals((a) => ({ ...a, brew: elapsed }));
      setPhase('judge');
    } else {
      setActuals((a) => ({ ...a, judge: elapsed }));
      setPhase('done');
    }
    stopwatch.reset();
    if (phase !== 'judge') stopwatch.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, phase]);

  function start() {
    setMarks([]);
    setActuals({ prep: 0, brew: 0, judge: 0 });
    setChecked({});
    setPhase('prep');
    stopwatch.reset();
    stopwatch.start();
  }

  function mark(label: string) {
    setMarks((m) => [...m, { label, atSec: Math.round(stopwatch.elapsed), phase }]);
  }

  async function save() {
    const record: RehearsalRecord = {
      id: uid('rehearsal'),
      date: new Date().toISOString(),
      competitionId: competition.id,
      prepActualSec: actuals.prep,
      brewActualSec: actuals.brew,
      judgeActualSec: actuals.judge,
      marks,
    };
    await saveRehearsal(record);
    setPhase('idle');
  }

  return (
    <>
      <Card title="競技リハーサル" hint="準備7:00 → 競技7:00 → 審査3:00 を自動で遷移します。一時停止はできません。">
        <div className={`timer ${phase !== 'idle' && phase !== 'done' && remaining <= 30 ? 'warning' : ''}`}>
          {phase === 'idle' || phase === 'done' ? '—:—' : formatSeconds(Math.max(0, remaining))}
        </div>
        <div className="row between">
          <Pill tone={phase === 'brew' ? 'danger' : phase === 'prep' ? 'warn' : 'plain'}>{PHASE_LABEL[phase]}</Pill>
          <span className="muted">経過 {formatSeconds(stopwatch.elapsed)}</span>
        </div>
        {phase === 'idle' ? (
          <button className="primary" type="button" onClick={start}>
            リハーサル開始
          </button>
        ) : phase === 'done' ? (
          <button className="primary" type="button" onClick={save}>
            記録を保存
          </button>
        ) : (
          <div className="row">
            <button type="button" onClick={() => mark('注湯開始')}>
              注湯マーク
            </button>
            <button type="button" onClick={() => mark('提出')}>
              提出マーク
            </button>
          </div>
        )}
      </Card>

      <Card title="準備チェックリスト" hint="準備7分でやることを固定化し、本番の判断を減らします。">
        <div className="stack">
          {settings.prepChecklist.map((item) => (
            <label key={item} className="checkbox">
              <input
                type="checkbox"
                checked={checked[item] ?? false}
                onChange={(event) => setChecked({ ...checked, [item]: event.target.checked })}
              />
              <span>{item}</span>
            </label>
          ))}
        </div>
      </Card>

      {marks.length > 0 ? (
        <Card title="このリハーサルのマーク">
          <ul className="list-plain">
            {marks.map((m, i) => (
              <li key={`${m.label}${i}`}>
                <span className="mono">{formatSeconds(m.atSec)}</span> {PHASE_LABEL[m.phase]} / {m.label}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title="履歴">
        {rehearsals.length === 0 ? (
          <Banner>まだリハーサル記録がありません。</Banner>
        ) : (
          <table>
            <thead>
              <tr>
                <th>日付</th>
                <th>準備</th>
                <th>競技</th>
                <th>審査</th>
              </tr>
            </thead>
            <tbody>
              {rehearsals.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.date).toLocaleDateString('ja-JP')}</td>
                  <td className="mono">{formatSeconds(r.prepActualSec)}</td>
                  <td className="mono">{formatSeconds(r.brewActualSec)}</td>
                  <td className="mono">{formatSeconds(r.judgeActualSec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
