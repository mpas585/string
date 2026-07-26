/*
  omr/tosong.js — OMR の結果を songs.js が読める曲JSONに変換する。

  出力は public/songs/*.json と【同じ形】でなければならない。
  別形式を作らないこと。同じ形にしておけば、置き場所が
  public/ でも localStorage でも DB でも、通る道は一つで済む。

    {
      "id": "...", "title": {"ja": "..."}, "desc": {"ja": "..."},
      "tempo": 79, "beatsPerMeasure": 3, "beatUnit": 1,
      "notes": [[midi, dur], ...]        ← midi 0 は休符
    }

  songs.js の buildSongFromData() は notes を頭から読んで onset を積み上げ、
  midi が 0 なら「イベントを作らず時間だけ進める」。つまり休符は [0, 拍数] で表す。

  ■ 拍子について
    拍子記号はまだ読んでいない。小節ごとの音価の合計から推定する。
    最頻値を採るので、休符の取りこぼしがある小節があっても引きずられにくい。
    推定できなければ opts.beatsPerMeasure（既定 4）を使う。

  ■ 和音について
    songs.js の notes は1音ずつの並びで、和音を書けない。
    同じ位置に複数の符頭があるときは【いちばん高い音】を採る。
    チェロの譜面で和音の上の音が旋律であることが多いため。
    opts.chordPick で 'low' にすれば下の音を採る。
*/

/** 小数誤差を丸める（0.1 刻みまで） */
const r4 = (v) => Math.round(v * 10000) / 10000;

/**
 * 音符と休符を1本の列に並べる。
 *
 * 音符は pitch.js が音高を、duration.js が音価を持っている。
 * 両者は同じ符頭を指すので、staff/x/step で突き合わせる。
 *
 * @returns {Array<{x:number, staff:number, midi:number, dur:number, measure:number|null, tie:boolean}>}
 */
function mergeStream(pitchResult, durationResult, restResult, measureResult, opts) {
  const { chordPick = 'high', chordTol = 0.55 } = opts;

  const durAt = new Map();
  if (durationResult) {
    for (const h of durationResult.heads) durAt.set(`${h.staff}:${Math.round(h.x)}:${h.step}`, h);
  }
  const measureAt = new Map();
  if (measureResult) {
    for (const m of measureResult.heads) measureAt.set(`${m.staff}:${Math.round(m.x)}:${m.step}`, m.measure);
  }

  /* 音符 */
  const notes = pitchResult.heads.map(n => {
    const k = `${n.staff}:${Math.round(n.x)}:${n.step}`;
    const dv = durAt.get(k);
    return {
      x: n.x, staff: n.staff, midi: n.midi,
      dur: dv ? dv.dur : 1,
      tie: dv ? !!dv.tie : false,
      measure: n.measure ?? measureAt.get(k) ?? null,
      isRest: false,
    };
  });

  /* 休符。小節番号は「その小節線より左か」で決める */
  const rests = [];
  if (restResult) {
    for (const rst of restResult.rests) {
      let measure = null;
      if (measureResult) {
        const notesBefore = notes.filter(n => n.staff === rst.staff && n.x < rst.x);
        const notesAfter = notes.filter(n => n.staff === rst.staff && n.x > rst.x);
        /* 前後の音符の小節番号が一致すればそれ。違えば小節線の位置で決める */
        const before = notesBefore.length ? notesBefore[notesBefore.length - 1].measure : null;
        const after = notesAfter.length ? notesAfter[0].measure : null;
        if (before !== null && before === after) measure = before;
        else if (before !== null) {
          const bars = (measureResult.byStaff[rst.staff] || []).filter(b => b.x > (notesBefore[notesBefore.length - 1].x) && b.x < rst.x);
          measure = before + bars.length;
        } else measure = after;
      }
      rests.push({ x: rst.x, staff: rst.staff, midi: 0, dur: rst.dur, tie: false, measure, isRest: true });
    }
  }

  /* 段順・x順に並べる */
  const all = [...notes, ...rests].sort((a, b) => a.staff - b.staff || a.x - b.x);

  /* 和音を畳む。同じ段で x が近いものは1つの音とみなす */
  const out = [];
  for (const it of all) {
    const prev = out[out.length - 1];
    if (prev && !it.isRest && !prev.isRest && prev.staff === it.staff &&
        Math.abs(prev.x - it.x) < chordTol * 20) {
      /* 和音。採る方の音に差し替える */
      const take = chordPick === 'low' ? (it.midi < prev.midi) : (it.midi > prev.midi);
      if (take) { prev.midi = it.midi; }
      prev.dur = Math.max(prev.dur, it.dur);
      prev.tie = prev.tie || it.tie;
      continue;
    }
    out.push({ ...it });
  }
  return out;
}

/**
 * 小節ごとの音価の合計から拍子を推定する。
 * 最頻値を採る。合計が整数に近い小節だけを数える。
 */
function guessBeatsPerMeasure(stream, fallback) {
  const sums = new Map();
  for (const it of stream) {
    if (it.measure == null) continue;
    sums.set(it.measure, r4((sums.get(it.measure) || 0) + it.dur));
  }
  const votes = {};
  for (const v of sums.values()) {
    if (v <= 0 || v > 16) continue;
    if (Math.abs(v - Math.round(v)) > 0.01) continue;      /* 半端な小節は数えない */
    const k = Math.round(v);
    votes[k] = (votes[k] || 0) + 1;
  }
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  return best ? +best[0] : fallback;
}

/**
 * OMR の結果を曲JSONにする。
 *
 * @param {Object} args
 *   pitch     … pitch.js の assignPitches() の結果（必須）
 *   durations … duration.js の detectDurations() の結果（省略時は全て1拍）
 *   rests     … rest.js の detectRests() の結果（省略時は休符なし）
 *   measures  … barline.js の detectMeasures() の結果（省略時は小節を推定しない）
 * @param {Object} [opts]
 *   id / title / desc / tempo / beatsPerMeasure / beatUnit … そのまま出力に入れる
 *   chordPick … 'high'（既定）か 'low'
 * @returns {{song:Object, warnings:Array<string>}}
 */
export function toSong({ pitch, durations = null, rests = null, measures = null }, opts = {}) {
  const {
    id = 'scan',
    title = null,
    desc = null,
    tempo = 80,
    beatUnit = 1,
    beatsPerMeasure = null,
    chordPick = 'high',
  } = opts;

  if (!pitch || !pitch.heads || !pitch.heads.length) {
    throw new Error('音符がありません（先に assignPitches を通してください）');
  }

  const stream = mergeStream(pitch, durations, rests, measures, { chordPick });
  const bpm = beatsPerMeasure || guessBeatsPerMeasure(stream, 4);

  /* タイを畳む。同じ高さの次の音に足し込む */
  const notes = [];
  for (let i = 0; i < stream.length; i++) {
    const cur = { ...stream[i] };
    while (cur.tie && i + 1 < stream.length &&
           stream[i + 1].midi === cur.midi && !stream[i + 1].isRest) {
      cur.dur = r4(cur.dur + stream[i + 1].dur);
      cur.tie = stream[i + 1].tie;
      i++;
    }
    notes.push([cur.midi, r4(cur.dur)]);
  }

  /* 気になる点を拾っておく。読み取りが怪しい所を人が見つけられるように */
  const warnings = [];
  if (pitch.summary.lowConfidence && pitch.summary.lowConfidence.length) {
    warnings.push(`音部記号の判定が怪しい段: ${pitch.summary.lowConfidence.join(', ')}`);
  }
  if (!measures) warnings.push('小節線を渡していないので、臨時記号と小節番号は反映されていません');
  if (!durations) warnings.push('音価を渡していないので、すべて1拍として出力しました');
  if (!rests) warnings.push('休符を渡していないので、休みのぶん時間が詰まっています');

  /* 小節ごとの合計が拍子と合わない所を挙げる（休符の取りこぼしが分かる） */
  if (measures) {
    const sums = new Map();
    for (const it of stream) {
      if (it.measure == null) continue;
      sums.set(it.measure, r4((sums.get(it.measure) || 0) + it.dur));
    }
    const bad = [...sums.entries()].filter(([, v]) => Math.abs(v - bpm) > 0.01);
    if (bad.length) {
      const head = bad.slice(0, 8).map(([m, v]) => `${m}(${v})`).join(' ');
      warnings.push(`拍数が ${bpm} と合わない小節 ${bad.length} 個: ${head}${bad.length > 8 ? ' …' : ''}`);
    }
  }

  const song = {
    id,
    title: title || { ja: '読み取った譜面', en: 'Scanned score', es: 'Partitura escaneada', zh: '扫描的乐谱' },
    desc: desc || undefined,
    tempo,
    beatsPerMeasure: bpm,
    beatUnit,
    notes,
  };
  if (!song.desc) delete song.desc;

  return {
    song,
    warnings,
    stats: {
      notes: notes.filter(n => n[0] > 0).length,
      rests: notes.filter(n => n[0] === 0).length,
      measures: measures ? measures.summary.measures : null,
      totalBeats: r4(notes.reduce((a, n) => a + n[1], 0)),
    },
  };
}
