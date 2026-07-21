# チェロ練習アプリ（モジュール分割・サーバー配信版）

単一HTML（`cello-finger.html`）を**素の ES モジュール**へ分割したもの。
ビルド工程なし・minifyなし（コードは書いたまま配信）。**http 配信前提**（file:// では
`import` が動かない）。サーバーに置けばそのまま動く。

## 起動 / 配信

ビルド不要。サーバーの公開ディレクトリに一式を置くだけ。ローカル確認は任意の静的サーバーで:

```
python3 -m http.server 8000      # → http://localhost:8000
# or: npx serve .
```

- `import` は必ず**拡張子付き**（`'./state.js'`）。素のブラウザは拡張子を補完しない。
- CDN依存（jszip / pdfjs）は `index.html` の **importmap** で解決（npm不使用）。
- 設置先はサブディレクトリ（例 `gud.co.jp/cello/`）でも可。参照は相対パス（`../../src/...`）。
- 入口は PHP になったので静的サーバーでは不可。`php -S localhost:8000` などで確認する。

---

## ディレクトリ構成

```
string/
├─ index.php             # ルート。言語判定 → /{言語}/cello/ へリダイレクト
├─ sitemap.php           # config/app.php から sitemap を生成（ready=true の楽器のみ）
├─ robots.txt            # ※ドメイン直下に移すこと。サブディレクトリでは無効
├─ ja/ en/ es/ zh/       # 言語ディレクトリ
│  ├─ index.php          # 楽器未指定 → 既定楽器へリダイレクト
│  └─ cello/index.php    # $LANG と $INSTRUMENT を定義して基幹PHPを require するだけ
├─ includes/
│  ├─ string_instrument.php  # 基幹（約110行）。検証・config/言語の読込・ビューの振り分けのみ
│  ├─ views/
│  │  ├─ app.php         # アプリ本体のHTMLシェル（旧 index.html）
│  │  └─ soon.php        # 準備中の楽器（ready=false）のページ
│  ├─ fingering.php      # ゾーン判定・指番号（JS の zoneOf/fingerHint と同じ規則）
│  ├─ midi.php           # 音名・周波数・弦長比（JS の midiName/fracOf と同じ規則）
│  └─ lang/{ja,en,es,zh}.php  # 文言・音名・ゾーンラベル
├─ config/
│  ├─ app.php            # 対応言語・対応楽器・既定値（ここが唯一の定義）
│  ├─ cello.php          # 開放弦・弦名・ゾーン境界・指番号テーブル（ready=true）
│  ├─ violin.php         # 調弦のみ（ready=false ＝「準備中」ページ）
│  └─ viola.php          # 同上
├─ public/               # そのまま配信される静的アセット（fetch対象）
│  ├─ songs/
│  │  ├─ manifest.json   # 曲一覧（先読み）
│  │  └─ kirakira.json   # 1曲1ファイル（選択時に遅延fetch）
│  └─ scales/
│     └─ scales.json     # スケール定義（起動時に先読み）
└─ src/
   ├─ main.js            # エントリ。init順序・移植ロードマップ
   ├─ styles.css         # 元<style>の移植先（index.htmlの<link>で読む）
   ├─ state.js           # ST(状態) + 定数（OPEN弦, NOTE_NAMES 等）
   ├─ util.js            # 純粋関数（midiName 等）＋楽器定数（window.INSTRUMENT から受取）
   ├─ dom.js             # $ / on ヘルパ、要素参照
   ├─ fingerboard.js     # 指板描画
   ├─ scale.js           # スケール生成（buildScaleEvents, SCALES）
   ├─ drawer.js          # ドロワー（open/close, タブ, 子タブ, 設定UI）
   ├─ modes.js           # setMode / applyMode / オクターブ等モード横断
   ├─ songs.js           # 曲ローダ（manifest取得, loadSong, データ→events変換）
   ├─ notation.js        # 五線譜レンダラ（静的import）
   ├─ tuner.js           # ピッチ検出（静的import）
   ├─ pdf.js             # PDF表示（pdfjsは基幹PHPでグローバル読み込み）
   └─ audio/
      ├─ context.js      # 永続AudioContext, warmAudio, 音量バス
      ├─ synth.js        # 発音（チェロ/ドラム/ベース/コード/メトロノーム）
      ├─ ir.js           # リバーブIRの合成生成（外部アセット不要）
      └─ scheduler.js    # 再生スケジューラ（startPlay/stopPlay/setTempo）★Batch5
```

### 多言語 / 多楽器（PHP 化）
URL は `/{言語}/{楽器}/` の2階層固定。`/ja/cello/index.php` は次の3行だけ:

```php
$LANG = 'ja'; $INSTRUMENT = 'cello';
require __DIR__ . '/../../includes/string_instrument.php';
```

基幹 `includes/string_instrument.php` が
`config/{楽器}.php`（開放弦・ゾーン・指番号）と `includes/lang/{言語}.php`（文言）を読み、
合成した値を `window.INSTRUMENT` / `window.APP` として出力する。
`src/util.js` はそれを読むだけで、未注入なら従来どおりチェロ・日本語で動く（＝JS単体でも壊れない）。

- **対応言語・対応楽器の定義は `config/app.php` の1ファイルだけ**（ルートの `index.php` も基幹PHPもここを読む）。
  ここを直すと hreflang・言語セレクト・ホワイトリスト・`/` からの転送先・準備中ページの戻り先が同時に効く。
- 言語を足す: `config/app.php` の `langs` に追加 → `includes/lang/xx.php` を作る →
  `/xx/index.php`（既存の `ja/index.php` を写す）と `/xx/{楽器}/index.php` を置く。
- 楽器を足す: `config/app.php` の `instruments` に追加 → `config/yy.php` を作る →
  `includes/lang/*.php` の `instrument` に楽器名を足す → `/{言語}/yy/index.php` を置く。
- `src/` と `public/` はルート直下のまま。参照は `../../` 固定なのでサブディレクトリ設置でも動く。
- **HTML は `includes/views/` にしかない。** 画面を直すときは基幹PHPを開かなくてよい。
  ビューからは基幹側で作った変数（`$T` `$INST` `$INST_NAME` `$BASE` `$LANG_URLS` 等）と
  `t()` / `h()` / `e()` / `er()` がそのまま使える。
- `config/*.php` `includes/*.php` は `STRING_APP` 未定義なら 403。基幹PHP自体も直接URLで叩かれたら 403。
- SEO: 各ページに `canonical`、全言語の `hreflang`、既定楽器のみ `x-default`（＝Accept-Language で
  振り分けるルート）を出力する。サイトマップは `sitemap.php` が `config/app.php` から自動生成するので、
  言語や楽器を足しても手を入れる必要はない。
- 入口（モード選択）の下に説明・機能・使い方・FAQ を出す。文言は `includes/lang/*.php` の `intro.*`。
  FAQ は同じデータから FAQPage の JSON-LD も出力するので、**FAQ を直すときは lang ファイルだけ**でよい
  （画面表示と構造化データが食い違わない）。
- 楽器固有の値はすべて `config/{楽器}.php` が出所で、JS 側にハードコードは残っていない:

  | config のキー | 効く場所 |
  | --- | --- |
  | `open` / `strnames` | `src/util.js` の `OPEN` / `STRNAME` |
  | `zones` / `finger_table` / `finger_high` | `zoneOf()` / `fingerHint()` |
  | `max_off` | `src/fingerboard.js` の `FB.maxOff` と `FB.fmax` |
  | `board` | `FB` の指板SVG寸法（`vbW/vbH/bx/bw/strX/strW/topY/botY`） |
  | `scale_max_off` | `src/scale.js` の音域上限 |

  JS 側には同じ値がフォールバックとして残してあるので、PHP を通さず開いても従来どおりチェロで動く。
- 保存キーは楽器ごとに分かれる（`cf:{楽器}:settings:v1` / `cf:{楽器}:{譜面ハッシュ}:{音数}`）。
  楽器別にする前の `cf:…` はチェロ専用だったので、**チェロのときだけ読み込みで互換参照**する
  （旧キーは消さないので切り戻せる）。
- violin/viola の `board` と `scale_max_off` は暫定値。`ready=true` にする前に実機に合わせて見直すこと。
- 部分翻訳可: 訳し漏れたキーは `array_replace_recursive` で **ja の文言に自動フォールバック**する
  （キー名が画面に出ることはない）。ja にも無い場合だけキー名が出る＝打ち間違いの検出になる。
- 辞書は `includes/lang/{言語}.php` の**1ファイルのみ**。同じ内容が `window.T` としても出力されるので、
  JS 側の文言もここから引く（JS用の辞書を別に作らないこと）。JS 側の取り出しは例えば:

```js
const T = (typeof window!=='undefined' && window.T) ? window.T : {};
export const tt = (k, d='') => k.split('.').reduce((o,x)=> (o&&o[x]!=null)?o[x]:null, T) ?? d;
```

- JS 側の文言も `includes/lang/*.php` の `msg.*` から引く。`src/util.js` の `tt('msg.xxx', ...args)` を使い、
  `%s` / `%1$s` で引数を差し込む（PHP の vsprintf と同じ書き方）。キーが無いときはキー名が返る。
- 外部JSON（`scales.json` / `manifest.json` / 曲JSON）の文字列は `{"ja":"…","en":"…"}` の形で持てる。
  読み出しは `pickText()`（表示言語 → ja → 先頭の順）。ただの文字列のままでも動く（後方互換）。
- JS に残る日本語は、PHP を通さず開いたときのフォールバック（`util.js` のゾーン名・指番号、
  `fingerboard.js` の MARKERS、`scale.js` の FALLBACK_SCALES）と、開発者向けの console 出力のみ。

### 依存の向き（上が下に依存）
```
main → modes → { scale, songs, notation★, tuner★, pdf★ }
modes → fingerboard → dom
audio/* → audio/context
すべて → state, dom, util（末端）
```

### モジュール読み込み（最終実装）
すべて静的 import。当初は notation/tuner/pdf を動的 import（遅延）にする計画だったが、
`render` 統括や `transportTick` が同期で呼ぶため静的に変更した。重いライブラリは
pdfjs / JSZip のみで、これらは元コードどおり index.html の `<script>` でグローバル
（`window.pdfjsLib` / `window.JSZip`）読み込み。曲データは `public/songs/` にあるが、
曲データは `public/songs/` から fetch する（`SONGS` のハードコードは廃止）。

初期表示に必要なのは state/dom/util/audio(context,synth,scheduler)/fingerboard/drawer/modes/scale のみ。譜面・チューナー・PDF・IR・曲は初期ロードから外れる。

**曲・スケールは外部JSON化済み。** `main.js` の初期化は
`await Promise.all([loadScales(), loadSongManifest()])` → `loadSettings()` の順。
保存済み `scaleType` の照合と `#scaleType` の `<option>` 生成に定義が要るため、この順序は変えないこと。
パスは `import.meta.url` 基準（`../public/...`）なのでサブディレクトリ設置でも解決できる。
fetch できない環境（file:// 等）ではスケールのみ `FALLBACK_SCALES` に落ちる（曲は空一覧）。

---

## 移植マッピング（元 `cello-finger.html` → 新モジュール）

行番号は移植時に `grep`/`view` で最終確定する。以下は目印。

| 元の機能 | 現HTMLの目印 | 移植先 |
|---|---|---|
| `<style>` 全体 | `<head>`内 | `src/styles.css` |
| `<body>`直下の静的DOM（#board, ツールバー, `<aside>`ドロワー等） | `<body>`直下 | `index.html` の `#app` |
| 定数 `OPEN`(開放弦), `NOTE_NAMES`, `ST`(状態) | JS冒頭 | `state.js` |
| `midiName` 等の純粋関数 | JS内 | `util.js` |
| `$` / `on(id,ev,fn)` ヘルパ、要素取得 | `on` は近傍にログ出力あり | `dom.js` |
| 指板描画コア（`renderBoard`/`drawBoardStatic`/`paintNotes`/振動/ズーム） | 現L1039–1058,1159–1335,2715–2730,3430–3479 | `fingerboard.js` |
| 全体描画統括 `render`（モード分岐→指板/譜面/チューナー） | 現L1338–1384 | `modes.js`（★Batch5） |
| `pluckString`, `vibLoop`（弦振動＝指板SVGを動かす） | 現L1300–1335 | `fingerboard.js`（DOM依存のため） |
| AudioContext / `warmAudio` / master | 現L2515–2559 | `audio/context.js` |
| IR / Convolver | 現L2306–2319 | `audio/ir.js`（合成生成。外部アセット不要） |
| 再生スケジューラ（`startPlay`/`stopPlay`/`setTempo`/`transportTick`） | 現L2561–、L1759 | `audio/scheduler.js`（★Batch5：fingerboard等に依存） |
| `SCALES` / `SCALE_LABEL` / `isMinorScale` / `buildScaleEvents` / `progressionFor` | 現L2187–2245（ポップスのみ） | `scale.js` |
| `genScale`（生成→setScore→自動再生の統括） | 現L3067–3084 | `modes.js`（★Batch5） |
| ドロワー `openDrawer`/`closeDrawer`、タブ、子タブ、設定UI | `setScoreSub` は現L3720付近 | `drawer.js` |
| `setMode`（`keepDrawer`対応済）/ `applyMode` / `setOctave`/`applyOctave`（±3） | `setMode` は現L1535 | `modes.js` |
| `buildSongKirakira` / `SONGS` / `loadSong` / `loadSample`(白鳥) | 現L3088–3114付近 | `songs.js` |
| 五線譜レンダラ | — | `notation.js`（動的import） |
| チューナー（`startTuner` / `TUN`） | — | `tuner.js`（動的import） |
| PDF取り込み（`pdfOpen`） | — | `pdf.js`（動的import） |

### 曲データの外部化フォーマット（確定）
`buildSongKirakira` のハードコードを廃し、`public/songs/*.json` へ（実装済み）。
`notes` は `[midi, beats]` の配列（`kirakira.json` 参照）。
運指付与・小節割り・`name`生成などの変換ロジックは `songs.js` 側に残し、JSONは生データのみ持つ。
`drawer.js` は `manifest.json` を fetch して曲ボタンを生成、選択で個別JSONを fetch。

### スケールの外部化
`public/scales/scales.json`（`id`/`label`/`intervals`）を `loadScales()` が fetch し、`SCALES`/`SCALE_LABEL`
を**中身だけ差し替える**（オブジェクト参照は保つ＝`drawer.js`/`modes.js` の import が生きたまま効く）。
同時に `#scaleType` の `<option>` も作り直す。スケールを増やすときは JSON に1行足すだけでよい。

---

## 移植バッチ順（末端→上位。各バッチはその機能の元コードのみ読む）

1. **core** ✅完了 … `state.js` / `util.js` / `dom.js` / `styles.css`
2. **audio** ✅完了 … `audio/context.js` / `ir.js` / `synth.js`（IRは合成生成＝書き出し不要。scheduler は依存の都合で 5 へ）
3. **DOM + 指板** ✅完了 … `index.html`(#app にDOM移植) / `fingerboard.js`（描画コア。render統括・fbsvg配線・setZoom は依存の都合で 5 へ）
4. **scale** ✅完了 … `scale.js`（定義＋生成ロジック。`genScale` 統括は 5 へ。`scales.json` 用意済み）
5. **scheduler / notation / tuner / modes / drawer** ✅完了 … 再生・五線譜・チューナー・統括(render/setMode/genScale/オクターブ)・設定/永続化。相互依存の葉から順に結線
6. **songs** ✅完了 … `songs.js`（MusicXML/MIDIパーサ・トラック・曲/サンプル読込）。`SONGS`はコード内、外部フォーマットは `public/` に用意
7. **pdf + 配線** ✅完了 … `pdf.js` / `main.js`（全 on(...) 配線＋初期化）。押弦発音は fingerboard.js に統合

**全16モジュール移植完了。** 各モジュールは元コードと diff 一致（無改変＋export付与）、全 import 解決済み。
※ 実ブラウザ（Chromium）で通し動作を確認済み：モード選択・再生/停止・子タブ・曲選択（キラキラ星）・
オクターブ・ループ・テンポ・設定(ギア)・チューナー・音符選択・シーク・リロード後の設定復元。

### 分割で踏んだ落とし穴（同種の再発防止メモ）
1. **変数の参照漏れ** … 依存を「関数呼び出し」だけで洗うと `TUN`/`OPEN`/`SCALES` 等の *変数* を落とす。
2. **関数の参照渡し漏れ** … `on('gear','click', closeGear)` は `closeGear(` の形にならないため呼び出し検索では見つからない。
3. **`export let` への外部代入** … ESモジュールは読み取り専用。`midiFile=null` 等は setter（`setMidiFile`）経由に変更。
4. **複数宣言の取りこぼし** … `export let AUD=null, IRBUF=null, NOISEBUF=null;` の2個目以降を解析が落とし、
   `NOISEBUF` 未importで再生が無反応になった（＝startPlay内でReferenceError）。
5. **配線ブロックの範囲ミス** … `on()` 定義の直後にあった基本配線12個（`fab`=再生ボタン含む）を範囲外にして落とした。

各バッチ完了時に `npm run dev` で動作確認 → 次へ。全ファイル通読はしない。

---

## コード秘匿について（結論）

シンセ・指板・譜面・スケジューラはブラウザで動くため JS として配信され、**PHPに載せ替えても中核は隠せない**。今回はコード秘匿を目的にしないと決定（minifyも行わない）。分割の目的は**メンテのしやすさ**。本気で守りたい塊が出てきたら、その一部だけサーバー実行にする（＝コードを隠すのではなく資産を守る）方針に切り替える。
