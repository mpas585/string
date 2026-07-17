/*
  audio/ir.js — リバーブ用インパルス応答（合成生成）。
  元 cello-finger.html L2306–2318 より無改変で移植。末端（ctx引数のみ）。
  ※ IRは .wav 等の外部ファイルではなくコードで生成する。外部アセット不要。
*/

/* リバーブ用のインパルス応答（合成）— Math.pow を使わず高速化 */
export function makeReverbIR(ctx, sec, decay){
  const rate=ctx.sampleRate, len=Math.max(1, Math.floor(rate*sec));
  const buf=ctx.createBuffer(2, len, rate);
  for(let ch=0; ch<2; ch++){
    const d=buf.getChannelData(ch);
    for(let i=0;i<len;i++){
      const x=1 - i/len;
      const env=x*x*x;                    /* ≒pow(x,3)。掛け算だけで済ませる */
      d[i]=(Math.random()*2-1)*env;
    }
  }
  return buf;
}
