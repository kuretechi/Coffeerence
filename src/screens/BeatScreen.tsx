import { useRef, useState } from 'react';
import { Banner, Card } from '../ui/components';
import { useBeatPattern, useLoopSounds } from '../ui/data';
import { measureDuration, useBeatMachine } from '../ui/useBeatMachine';
import {
  LOOP_ACCEPT,
  LoopSoundTooLargeError,
  MAX_LOOP_BYTES,
  deleteLoopSound,
  renameLoopSound,
  saveBeatPattern,
  saveLoopSound,
} from '../db/loopRepo';
import {
  BARS_RANGE,
  BPM_RANGE,
  STEPS_PER_BEAT,
  TRACK_LABELS,
  assignTrack,
  basicBeat,
  bpmForDuration,
  clearTrack,
  eraseAll,
  eraseTrack,
  formatSeconds,
  isBarHead,
  isBeatHead,
  loopSeconds,
  stepCount,
  toggleMute,
  toggleStep,
} from '../lib/beatGrid';
import type { BeatPattern, LoopSound } from '../domain/types';

/** 素材を選ぶトラック。null なら選択シートを閉じている。 */
type PickingTrack = number | null;

export function BeatScreen() {
  const pattern = useBeatPattern();
  const sounds = useLoopSounds();
  const machine = useBeatMachine(pattern, sounds);
  const [picking, setPicking] = useState<PickingTrack>(null);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  const update = (next: BeatPattern) => void saveBeatPattern(next);
  const byId = new Map(sounds.map((sound) => [sound.id, sound]));
  const steps = stepCount(pattern.bars);

  async function addFiles(files: readonly File[]): Promise<void> {
    if (files.length === 0) return;
    setNotice(undefined);
    for (const file of files) {
      const duration = await measureDuration(file);
      if (duration === 0) {
        setNotice(`「${file.name}」は音として開けませんでした。mp3 / wav / m4a などを選んでください。`);
        continue;
      }
      try {
        await saveLoopSound(file, duration);
      } catch (error) {
        setNotice(
          error instanceof LoopSoundTooLargeError
            ? `「${file.name}」は ${Math.round(MAX_LOOP_BYTES / 1024 / 1024)}MB を超えています。`
            : `「${file.name}」を保存できませんでした。`,
        );
      }
    }
  }

  async function remove(sound: LoopSound): Promise<void> {
    await deleteLoopSound(sound.id);
    machine.forget(sound.id);
  }

  return (
    <>
      <Card title="ビート" hint="タイルを叩いて並べ、16分のグリッドで鳴らします。">
        <div className="mixer-transport">
          <button
            type="button"
            className={machine.playing ? 'mixer-play playing' : 'mixer-play'}
            onClick={machine.toggle}
            aria-pressed={machine.playing}
          >
            {machine.playing ? '停止' : '再生'}
          </button>
          <dl className="mixer-loop">
            <div>
              <dt>BPM</dt>
              <dd>
                <Stepper
                  value={pattern.bpm}
                  min={BPM_RANGE.min}
                  max={BPM_RANGE.max}
                  onChange={(bpm) => update({ ...pattern, bpm })}
                />
              </dd>
            </div>
            <div>
              <dt>小節</dt>
              <dd>
                <Stepper
                  value={pattern.bars}
                  min={BARS_RANGE.min}
                  max={BARS_RANGE.max}
                  onChange={(bars) => update({ ...pattern, bars })}
                />
              </dd>
            </div>
            <div>
              <dt>1周</dt>
              <dd className="mono">{formatSeconds(loopSeconds(pattern.bpm, pattern.bars))}</dd>
            </div>
          </dl>
        </div>
        <label className="mixer-volume">
          <span>音量</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(pattern.volume * 100)}
            onChange={(event) => update({ ...pattern, volume: Number(event.target.value) / 100 })}
          />
        </label>
      </Card>

      <section className="beat-sheet" aria-label="タイルのグリッド">
        <div className="beat-rows">
          {pattern.tracks.map((track, index) => {
            const sound = track.soundId === undefined ? undefined : byId.get(track.soundId);
            return (
              <div key={index} className={track.muted ? 'beat-row muted' : 'beat-row'}>
                <div className="beat-head">
                  <button
                    type="button"
                    className="beat-name"
                    onClick={() => setPicking(index)}
                    aria-label={`${TRACK_LABELS[index]}の素材を選ぶ`}
                  >
                    <span className="beat-track-label">{TRACK_LABELS[index]}</span>
                    <span className={sound ? 'beat-sound' : 'beat-sound empty'}>{sound ? sound.name : '素材なし'}</span>
                  </button>
                  <button
                    type="button"
                    className={track.muted ? 'beat-mute on' : 'beat-mute'}
                    onClick={() => update({ ...pattern, tracks: toggleMute(pattern.tracks, index) })}
                    aria-label={`${TRACK_LABELS[index]}の消音`}
                    aria-pressed={track.muted}
                  >
                    {track.muted ? '消音' : '入'}
                  </button>
                </div>
                <div className="beat-tiles" role="group" aria-label={`${TRACK_LABELS[index]}のタイル`}>
                  {Array.from({ length: steps }, (_unused, step) => {
                    const on = track.steps[step] === true;
                    const classes = ['beat-tile'];
                    if (on) classes.push('on');
                    if (isBarHead(step)) classes.push('bar');
                    else if (isBeatHead(step)) classes.push('beat');
                    if (machine.step === step) classes.push('now');
                    return (
                      <button
                        key={step}
                        type="button"
                        className={classes.join(' ')}
                        aria-pressed={on}
                        aria-label={`${TRACK_LABELS[index]} ${Math.floor(step / STEPS_PER_BEAT) + 1}拍${
                          (step % STEPS_PER_BEAT) + 1
                        }`}
                        onClick={() => update({ ...pattern, tracks: toggleStep(pattern.tracks, index, step) })}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="beat-tools">
        <button type="button" onClick={() => update({ ...pattern, tracks: basicBeat(pattern.tracks, pattern.bars) })}>
          8ビートを入れる
        </button>
        <button type="button" onClick={() => update({ ...pattern, tracks: eraseAll(pattern.tracks) })}>
          全部消す
        </button>
      </div>

      <Card title="素材">
        {notice ? <Banner tone="danger">{notice}</Banner> : null}
        <div className="mixer-add">
          <button type="button" className="primary" onClick={() => fileInput.current?.click()}>
            mp3などを追加
          </button>
          <input
            ref={fileInput}
            type="file"
            hidden
            accept={LOOP_ACCEPT}
            multiple
            onChange={(event) => {
              // inputの値を戻すと files が空になるので、先に配列へ写す。
              const chosen = [...(event.target.files ?? [])];
              event.target.value = '';
              void addFiles(chosen);
            }}
          />
        </div>
        {sounds.length === 0 ? (
          <Banner>素材がまだありません。mp3 などを追加するとトラックに入れられます。</Banner>
        ) : (
          <ul className="mixer-library">
            {sounds.map((sound) => (
              <li key={sound.id}>
                <input
                  className="mixer-library-name"
                  value={sound.name}
                  aria-label="素材の名前"
                  onChange={(event) => void renameLoopSound(sound.id, event.target.value)}
                />
                <span className="mono muted">{formatSeconds(sound.durationSec)}</span>
                <div className="mixer-library-actions">
                  <button type="button" onClick={() => void machine.preview(sound)}>
                    試聴
                  </button>
                  <button
                    type="button"
                    onClick={() => update({ ...pattern, bpm: bpmForDuration(sound.durationSec, pattern.bars) })}
                    title="この素材の長さがちょうど1周になるBPMにする"
                  >
                    BPM合わせ
                  </button>
                  <button type="button" className="danger" onClick={() => void remove(sound)}>
                    削除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {picking === null ? null : (
        <div className="modal-backdrop" onClick={() => setPicking(null)}>
          <div
            className="modal mixer-picker-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={`${TRACK_LABELS[picking]}に入れる素材`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="wizard-head">
              <strong>{TRACK_LABELS[picking]}に入れる素材</strong>
              <button className="wizard-close" type="button" aria-label="閉じる" onClick={() => setPicking(null)}>
                ×
              </button>
            </div>
            {sounds.length === 0 ? (
              <Banner>素材がまだありません。下の「mp3などを追加」で登録してください。</Banner>
            ) : (
              <ul className="mixer-picker">
                {sounds.map((sound) => (
                  <li key={sound.id}>
                    <button
                      type="button"
                      className="mixer-picker-row"
                      onClick={() => {
                        update({ ...pattern, tracks: assignTrack(pattern.tracks, picking, sound.id) });
                        setPicking(null);
                      }}
                    >
                      <span>{sound.name}</span>
                      <span className="mono muted">{formatSeconds(sound.durationSec)}</span>
                    </button>
                    <button type="button" onClick={() => void machine.preview(sound)}>
                      試聴
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="beat-picker-tools">
              <button type="button" onClick={() => fileInput.current?.click()}>
                mp3などを追加
              </button>
              <button
                type="button"
                onClick={() => {
                  update({ ...pattern, tracks: clearTrack(pattern.tracks, picking) });
                  setPicking(null);
                }}
              >
                素材を外す
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  update({ ...pattern, tracks: eraseTrack(pattern.tracks, picking) });
                  setPicking(null);
                }}
              >
                タイルを消す
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** 1刻みで増減する数値。直接入力もできるようにする。 */
function Stepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <span className="mixer-stepper">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label="1減らす" disabled={value <= min}>
        −
      </button>
      <input
        type="number"
        className="mono"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} aria-label="1増やす" disabled={value >= max}>
        ＋
      </button>
    </span>
  );
}
