import { useRef, useState } from 'react';
import { Banner, Card } from '../ui/components';
import { useLoopSounds, useMixerBoard } from '../ui/data';
import { measureDuration, useLoopMixer } from '../ui/useLoopMixer';
import {
  LOOP_ACCEPT,
  LoopSoundTooLargeError,
  MAX_LOOP_BYTES,
  deleteLoopSound,
  renameLoopSound,
  saveLoopSound,
  saveMixerBoard,
} from '../db/loopRepo';
import {
  BARS_RANGE,
  BPM_RANGE,
  SLOT_LABELS,
  assignSlot,
  bpmForDuration,
  clearSlot,
  formatSeconds,
  loopSeconds,
  toggleMute,
} from '../lib/loopMixer';
import type { LoopSound, MixerBoard } from '../domain/types';

/** 素材を選ぶ枠。null なら選択シートを閉じている。 */
type PickingSlot = number | null;

export function MixerScreen() {
  const board = useMixerBoard();
  const sounds = useLoopSounds();
  const mixer = useLoopMixer(board, sounds);
  const [picking, setPicking] = useState<PickingSlot>(null);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  const update = (next: MixerBoard) => void saveMixerBoard(next);
  const byId = new Map(sounds.map((sound) => [sound.id, sound]));
  const loopSec = loopSeconds(board.bpm, board.bars);

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
    mixer.forget(sound.id);
  }

  return (
    <>
      <Card title="音重ね" hint="mp3 などの素材を枠に入れ、全部を同じ小節の頭から重ねて鳴らします。">
        <div className="mixer-transport">
          <button
            type="button"
            className={mixer.playing ? 'mixer-play playing' : 'mixer-play'}
            onClick={mixer.toggle}
            aria-pressed={mixer.playing}
          >
            {mixer.playing ? '停止' : '再生'}
          </button>
          <dl className="mixer-loop">
            <div>
              <dt>BPM</dt>
              <dd>
                <Stepper
                  value={board.bpm}
                  min={BPM_RANGE.min}
                  max={BPM_RANGE.max}
                  onChange={(bpm) => update({ ...board, bpm })}
                />
              </dd>
            </div>
            <div>
              <dt>小節</dt>
              <dd>
                <Stepper
                  value={board.bars}
                  min={BARS_RANGE.min}
                  max={BARS_RANGE.max}
                  onChange={(bars) => update({ ...board, bars })}
                />
              </dd>
            </div>
            <div>
              <dt>1周</dt>
              <dd className="mono">{formatSeconds(loopSec)}</dd>
            </div>
          </dl>
        </div>
        <label className="mixer-volume">
          <span>音量</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(board.volume * 100)}
            onChange={(event) => update({ ...board, volume: Number(event.target.value) / 100 })}
          />
        </label>
      </Card>

      <section className="mixer-grid" aria-label="演奏の枠">
        {board.slots.map((slot, index) => {
          const sound = slot.soundId === undefined ? undefined : byId.get(slot.soundId);
          const sounding = sound !== undefined && !slot.muted;
          return (
            <div key={index} className={sounding && mixer.playing ? 'mixer-slot sounding' : 'mixer-slot'}>
              <span className="mixer-slot-label">{SLOT_LABELS[index]}</span>
              {sound ? (
                <>
                  <button
                    type="button"
                    className="mixer-slot-main"
                    onClick={() => update({ ...board, slots: toggleMute(board.slots, index) })}
                    aria-pressed={!slot.muted}
                  >
                    <span className="mixer-slot-name">{sound.name}</span>
                    <span className="mixer-slot-state">{slot.muted ? '消音' : '鳴る'}</span>
                  </button>
                  <div className="mixer-slot-actions">
                    <button type="button" onClick={() => setPicking(index)} aria-label={`${SLOT_LABELS[index]}を差し替え`}>
                      変更
                    </button>
                    <button
                      type="button"
                      onClick={() => update({ ...board, slots: clearSlot(board.slots, index) })}
                      aria-label={`${SLOT_LABELS[index]}を外す`}
                    >
                      外す
                    </button>
                  </div>
                </>
              ) : (
                <button type="button" className="mixer-slot-main empty" onClick={() => setPicking(index)}>
                  <span className="mixer-slot-plus" aria-hidden="true">
                    ＋
                  </span>
                  <span className="mixer-slot-state">素材を入れる</span>
                </button>
              )}
            </div>
          );
        })}
      </section>

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
          <Banner>素材がまだありません。mp3 などを追加すると枠に入れられます。</Banner>
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
                  <button type="button" onClick={() => void mixer.preview(sound)}>
                    試聴
                  </button>
                  <button
                    type="button"
                    onClick={() => update({ ...board, bpm: bpmForDuration(sound.durationSec, board.bars) })}
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
            aria-label={`${SLOT_LABELS[picking]}に入れる素材`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="wizard-head">
              <strong>{SLOT_LABELS[picking]}に入れる素材</strong>
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
                        update({ ...board, slots: assignSlot(board.slots, picking, sound.id) });
                        setPicking(null);
                      }}
                    >
                      <span>{sound.name}</span>
                      <span className="mono muted">{formatSeconds(sound.durationSec)}</span>
                    </button>
                    <button type="button" onClick={() => void mixer.preview(sound)}>
                      試聴
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="primary" onClick={() => fileInput.current?.click()}>
              mp3などを追加
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** 1刻みで増減する数値。長押しの連続送りは使わず、直接入力もできるようにする。 */
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
