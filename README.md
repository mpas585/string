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
├─ .htaccess            # Apache設定（https強制 / sitemap.xml・manifest.webmanifest の書き換え / 遮断 / キャッシュ）
├─ index.php            # ルート。言語判定 → /{言語}/ へリダイレクト（x-default が指す言語中立URL）
├─ manifest.php         # PWAマニフェスト。?lang= と ?inst= で start_url を出し分ける
├─ sw.js                # Service Worker（ルート直下＝スコープ /）
├─ sitemap.php          # config/app.php から sitemap を生成（トップ＋ready=trueの楽器）
├─ robots.txt           # ドメイン直下に置くこと
├─ ja/ en/ es/ zh/      # 言語ディレクトリ
│  ├─ index.php         # 楽器選択トップ（$LANG を定義して includes/home.php を require）
│  └─ cello/index.php   # $LANG と $INSTRUMENT を定義して基幹PHPを require するだけ
├─ api/
│  ├─ auth.php          # 設定の保存（保存番号の作成/読込/上書き/削除）の JSON API
│  └─ contact.php       # お問い合わせ送信（mb_send_mail）
├─ data/                # 非公開。.htaccess で遮断。SQLite の実体（gitには入れない）
├─ includes/
│  ├─ bootstrap.php         # 共通（config読込・言語・辞書・h/t/e/er・パス算出）
│  ├─ home.php              # 楽器選択トップの基幹
│  ├─ string_instrument.php # 楽器ページの基幹。検証・楽器configの読込・ビューの振り分け
│  ├─ auth.php              # 保存番号の実処理（SQLite / 番号生成 / レート制限）
│  ├─ views/
│  │  ├─ home.php        # 楽器選択トップのHTML
│  │  ├─ app.php         # アプリ本体のHTMLシェル（旧 index.html）
│  │  ├─ analytics.php   # GA4 の計測タグ（config/app.php の ga_id が空なら出力しない）
│  │  └─ soon.php        # 準備中の楽器（ready=false）のページ
│  ├─ fingering.php      # ゾーン判定・指番号（JS の zoneOf/fingerHint と同じ規則）
│  ├─ midi.php           # 音名・周波数・弦長比（JS の midiName/fracOf と同じ規則）
│  └─ lang/{ja,en,es,zh}.php  # 文言・音名・ゾーンラベル・保存/問い合わせ/トップの文言
├─ config/
│  ├─ app.php            # 対応言語・対応楽器・既定値・問い合わせ宛先・DBパス（ここが唯一の定義）
│  ├─ cello.php          # 開放弦・弦名・ゾーン境界・指番号テーブル（ready=true）
│  ├─ violin.php         # 調弦のみ（ready=false ＝「準備中」ページ）
│  └─ viola.php          # 同上
├─ public/               # そのまま配信される静的アセット（fetch対象）
│  ├─ icons/             # PWA・ファビコン（192 / 512 / maskable / apple-touch）
│  ├─ songs/
│  │  ├─ manifest.json   # 曲一覧（先読み）
│  │  └─ kirakira.json   # 1曲1ファイル（選択時に遅延fetch）
│  └─ scales/
│     └─ scales.json     # スケール定義（起動時に先読み）
└─ src/
   ├─ main.js            # エントリ（アプリ本体 /{言語}/{楽器}/）。init順序・移植ロードマップ
   ├─ home.js            # エントリ（楽器選択トップ /{言語}/）。保存番号とPWAだけを配線する
   ├─ styles.css         # 元<style>の移植先（index.htmlの<link>で読む）
   ├─ state.js           # ST(状態) + 定数（OPEN弦, NOTE_NAMES 等）
   ├─ util.js            # 純粋関数（midiName 等）＋楽器定数（window.INSTRUMENT から受取）
   ├─ dom.js             # $ / on ヘルパ、要素参照、.dkmodal の開閉（トップと共用）
   ├─ fingerboard.js     # 指板描画
   ├─ scale.js           # スケール生成（buildScaleEvents, SCALES）
   ├─ drawer.js          # ドロワー（open/close, タブ, 子タブ, 設定UI）
   ├─ modes.js           # setMode / applyMode / オクターブ等モード横断
   ├─ songs.js           # 曲ローダ（manifest取得, loadSong, データ→events変換）
   ├─ notation.js        # 五線譜レンダラ（静的import）
   ├─ tuner.js           # ピッチ検出（静的import）
   ├─ pdf.js             # PDF表示（pdfjsは基幹PHPでグローバル読み込み）+ 検出用の描画
   ├─ omr-import.js      # PDFのページを読み取って譜面にする（omr/ とアプリの橋渡し）
   ├─ account.js         # 設定の保存＝保存番号（歯車のいちばん上）。api/auth.php を叩く
   ├─ contact.js         # お問い合わせ（歯車のいちばん下）。api/contact.php を叩く
   ├─ pwa.js             # Service Worker登録 と「ホーム画面に追加」。※自分で配線する
   └─ audio/
      ├─ context.js      # 永続AudioContext, warmAudio, 音量バス
      ├─ synth.js        # 発音（チェロ/ドラム/ベース/コード/メトロノーム）
      ├─ ir.js           # リバーブIRの合成生成（外部アセット不要）
      └─ scheduler.js    # 再生スケジューラ（startPlay/stopPlay/setTempo）★Batch5
```

### 多言語 / 多楽器（PHP 化）
URL は次の3段。`/` は実体を持たず、hreflang の x-default が指す言語中立URLとして使う。

```
/               → Accept-Language を見て /{言語}/ へ302
/{言語}/         → 楽器選択トップ（includes/home.php → views/home.php）
/{言語}/{楽器}/   → アプリ本体（includes/string_instrument.php → views/app.php）
```

言語・辞書・ヘルパ・パス算出は `includes/bootstrap.php` に集約してあり、トップと楽器ページの
どちらもこれを読む（`$URL_DEPTH` に公開URLの階層数を渡す）。

`/ja/cello/index.php` は次の3行だけ:

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

## 再生ボタンまわり

* **停止したら「止めた場所」から再開する。** `stopPlay()` が壊す前に `currentBeat()` を読んで
  `ST.playhead` に入れているので、次の `startPlay()`（引数なし）はそこから始まる。
  画面の表示も合わせるため、`#fab` の停止側では `stopPlay()` の直後に `seekTo(ST.playhead)` を呼ぶ。
* **最後まで鳴り切って止まった場合だけは範囲の頭へ戻す。** 曲末の `kind:'end'` も同じ `stopPlay()` を
  通るので、終端をそのまま覚えると次の ▶ が鳴らずに即終了してしまう（`ST.range.eB - 0.05` で判定）。
* **頭出し `#cue` は再生ボタンの真上**（`.cue` は `.fab` と同じ3つの bottom 指定を +68px でなぞる）。
  中身は `songs.js` の `skipToStart()` で、**再生中は先頭から鳴り直し・停止中は先頭へ移動**と
  両方を見ているので、再生中も停止中も押せる。出し入れは `updateChrome()` が `#fab` と同時に行う。
* 頭出しの行き先は `firstNoteBeat()`＝**最初に音が鳴る拍**（MIDIは冒頭が休符のことがある）。
  MIDIトラック一覧の `#skipStart` と同じ関数なので、動きは常に一致する。

## PDF譜面の読み取り（OMR）

`src/omr/`（五線・符頭・音高の検出）は単体で完結したモジュール群で、
`tools/omr-test.html` で各段階を目視確認できる。アプリ本体との橋渡しは `src/omr-import.js`。

入口は PDF表示オーバーレイの「取り込む」ボタン。処理は次の順:

```
renderPageForOmr(300dpi で裏描画) → detectStaves → detectNoteheads → assignPitches
  → groupHeads（段→左から右に並べ、縦に重なる符頭を和音にまとめる）
  → toScore（events 化。parseMusicXML と同じ形）→ setScore
```

### 検出の検証用データ

`src/omr/` を触ったら、**答えの分かっている譜面**で通すこと。目視では退行に気づけない。
Verovio で MusicXML から浄書した1ページ（全音符・2分・4分・8分連桁・16分2重連桁・付点4分を
含むヘ音記号6小節、300dpi）を使って、24音すべての音高と白黒が一致することを確認している。

**過去に見つかった誤りと原因**（同じ罠を踏まないための記録）:

| 症状 | 原因 |
|---|---|
| ページが3つに割れ右半分の音符が全滅 | `detectColumns` の空判定がページ高基準。段数が少ないと本文が余白扱いになる |
| 段まるごと音高がずれる | `detectClef` が五線の左の**パート名の文字**を記号と誤認 |
| ヘ音記号がト音記号に化ける | 記号の外接矩形に**小節番号**が混入し高さが1.5d→5.9dに膨らむ |
| 拍子記号の数字が音符になる | 調号が無いと `startX` が記号の直後で止まり拍子記号を跨げない |
| 全音符・2分音符が消える | 間に置かれた白玉は楕円の上下が五線の線そのもの。線を消すと輪が切れて穴が漏れる |
| 連桁の下に偽の白玉 | 符幹2本＋五線2本で囲まれた空きが穴に見える |

**読み取れる範囲をコード側の前提として明記しておく。**

* 読める：音の高さ、左から右への並び、和音、音部記号、調号
* 読めない：**音価**（符頭の白黒しか見ていない。旗・連桁・付点は未実装）、休符、
  小節線、拍子、タイ、スラー、繰り返し
* したがって **リズムは推定**（白玉2拍・黒玉1拍）で、拍子は4/4と仮定して小節を切っている。
  音程と運指の練習には使えるが、曲としての再生は正確でない。正確な再生が要るなら MusicXML。
* 対象は**表示中の1ページだけ**。複数ページはページごとに取り込む（後から取り込むと置き換わる）。
* 音部記号の判定が怪しい段があれば、取り込み後のトーストで件数を出す（黙って通さない）。

## PWA（ホーム画面に保存したときの挙動）

`manifest.php` + `sw.js` + `src/pwa.js` の3点。

* マニフェストは**言語・楽器ごとに `start_url` を変える**必要があるので静的ファイルにできない。
  `manifest.php?lang=ja&inst=cello` の形で各ページの `<link rel="manifest">` から引く
  （`.htaccess` で `/manifest.webmanifest` からも引ける）。`scope` は設置ディレクトリのルート。
* Service Worker は**ルート直下**に置く（置き場所がスコープの上限になるため）。
  HTML はネットワーク優先（言語切替やログイン状態を古いまま見せない）、`src/` と `public/` は
  stale-while-revalidate、`/api/` は一切キャッシュしない。**更新時は `sw.js` の `VER` を上げる。**
* `src/pwa.js` は**このファイルだけ自分でイベント配線する**。アプリ本体（main.js 経由）と
  楽器選択トップの両方から読まれるため、main.js の配線に載せられない。他モジュールに依存させないこと。
* iOS には `beforeinstallprompt` が無いので、共有メニューからの手順を文字で案内するだけにしている。
* アイコンは `public/icons/`。差し替えるときは**ファイル名を変える**こと（.htaccess で30日キャッシュ）。
* **「ホーム画面に追加」の導線は楽器選択トップ（`views/home.php` の言語選択の上）だけ**に置く。
  アプリ本体の歯車からは外した。`src/pwa.js` は `#pwaInstall` が無ければ何もしない
  （Service Worker の登録だけ行う）ので、置き場所を変えても JS は触らなくてよい。

## アナリティクス（GA4）

`includes/views/analytics.php` を3つのビュー（`app.php` / `home.php` / `soon.php`）の
`<head>` 冒頭から require する。**測定IDの定義は `config/app.php` の `ga_id` 1か所だけ**で、
空文字にすると計測タグを出力しない（ローカルや検証用のコピーで数字を汚さないため）。

* **`sw.js` で googletagmanager / google-analytics / analytics.google.com は素通しさせている。**
  Service Worker の「CDN＝キャッシュ優先」に落ちると計測ビーコンが握り潰されて数字が出なくなる。
  計測ドメインを増やすときはこの除外にも足すこと。

## 設定の保存（保存番号）

**ログインではなく「保存」。** メールアドレスもパスワードもセッションも無い。利用者は
**保存番号**（英字1文字＋数字4桁・例 `G4821`）だけで自分のデータを指す。同じ端末では番号を
LocalStorage に置いて起動時に自動で読み込むので、番号を打つのは他の端末に移るときだけ。
「アカウントを管理する」意識を持たせず、「この端末に自分の設定を置いている」感覚で使えることを狙う。

入口は2か所（アプリ本体＝歯車のいちばん上／トップ＝右上）。**要素IDを同じ（`svWho` `svBtn`
と `#mSave` / `#mSaveAsk` 一式）にしてあるので `src/account.js` を両方でそのまま共用している。**
そのためモーダルの開閉 `openDockModal` / `closeDockModal` は drawer.js から dom.js へ移した
（drawer.js からも再輸出しているので既存の import はそのまま）。

`includes/auth.php`（実処理）/ `api/auth.php`（JSON API）/ `src/account.js`（画面）。

### 流れ

```
初回          … 保存番号なしで全機能が使える（何も尋ねない）
保存が要る操作 … saveSettings() / saveFingering() → settingsChanged()
                 番号あり → 600ms まとめて UPDATE（確認なし。右下に「✓ 保存しました」）
                 番号なし → #mSaveAsk「設定を保存しますか？」を1訪問に1回だけ出す
起動時        … LocalStorage の番号 → api/auth.php(load) → 復元 → setSaveApply() で再描画
他端末        … #mSave で番号を入力 → 現在の設定を置換
```

* **設定変更の通知は `drawer.js` の2か所だけ**（`saveSettings()` と `saveFingering()`）。
  設定・運指の保存はここが唯一の出口なので、保存する項目を増やしても配線を足さなくてよい。
* 預けるのは **localStorage の `cf:` で始まるキーそのもの**（`{v:1, keys:{…}}`）。`drawer.js` の
  `Store` と同じ場所を読むので、楽器別の設定も運指も一括で持ち運べる。`cf:save:code`（番号自体）は除く。
* 起動時の復元は `setSaveApply()` に渡した手順（`loadSettings` → `applyMode` → `render` …）で
  画面に反映する。**中身を知っているのは main.js だけ**なので、account.js からは呼ばない。
  トップページは変える設定が無いので登録しない（読み込んだ値は LocalStorage 経由で本体に渡る）。
* `armSave()` より前の保存（音量の底上げなど起動時の自動保存）では尋ねない。
* 保存は SQLite 1ファイル。場所は `config/app.php` の `db_path`（既定は `data/app.db`）。
  **公開ディレクトリの外に置ける契約なら絶対パスにして `data/` ごと外へ移すこと。**
* 番号の英字は **I / L / O を除いた23文字**（1 / 0 と読み違えるため）＝23×10,000通り。
  `code` に UNIQUE 制約。衝突したら引き直す（`SAVE_GEN_TRY`）。
* **番号だけが鍵なので総当たりの的になる。** 存在しない番号を叩かれた回数を IP ごとに数え、
  10分で20回を超えたら窓が空くまで受け付けない（`SAVE_RATE_SEC` / `SAVE_RATE_MAX`・`save_hits` テーブル）。
  当たったリクエストは記録しない。番号空間を広げたいときは `SAVE_ALPHA` を2文字にする。
* **保存番号は URL に出さない**（履歴・アクセスログ・Referer に残さないため）＝読み出しも含めて全て POST。
  加えて `X-Requested-With: fetch` 必須＝素のフォーム送信では叩けない（CSRF よけ）。
* 紐付け解除は LocalStorage を消すだけで、サーバのデータは残す。消すのは「保存データを削除」だけ。
* 旧・会員（ニックネーム＋暗証番号4桁）は廃止。既存の `app.db` に `users` が残っているが参照しない。
  消したいときは手で `DROP TABLE users`（自動で消さないのは切り戻しの余地を残すため）。

## お問い合わせ

`api/contact.php` + `src/contact.js` + `#mContact`。入口は歯車のいちばん下。

* 宛先は `config/app.php` の `contact_to`。件名は必ず `[GEN strings] …` で始める（転送専用アドレスでの判別用）。
* `From` は**自ドメインのアドレス**にすること（さくらは自ドメイン以外の From を弾く）。返信は `Reply-To` に入る。
* ヘッダの改行除去（メールヘッダインジェクション対策）、罠フィールド、60秒の連投制限あり。

## .htaccess

ドメイン直下に置く前提。https強制（Service Worker とマイク入力の要件）、`/sitemap.xml` → `sitemap.php`、
`/manifest.webmanifest` → `manifest.php`、`.db` 等の遮断、`sw.js` の no-cache、
`Permissions-Policy: microphone=(self)`（チューナーが getUserMedia を使うため）、deflate と expires。
**`php_value` / `php_flag` は書かない**（PHP が CGI/FPM 実行だと 500 になる）。

## コード秘匿について（結論）

シンセ・指板・譜面・スケジューラはブラウザで動くため JS として配信され、**PHPに載せ替えても中核は隠せない**。今回はコード秘匿を目的にしないと決定（minifyも行わない）。分割の目的は**メンテのしやすさ**。本気で守りたい塊が出てきたら、その一部だけサーバー実行にする（＝コードを隠すのではなく資産を守る）方針に切り替える。
