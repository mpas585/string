<?php
/*
  config/app.php — 対応言語・対応楽器の唯一の定義。

  ここを直せば全体に効く（ルートの index.php も基幹PHPもこのファイルを読む）。

  言語を足すとき:
    1. このファイルの 'langs' に追加
    2. includes/lang/{言語}.php を作る（ja.php を写して訳す。訳し漏れは ja で自動フォールバック）
    3. /{言語}/{楽器}/index.php を楽器の数だけ作る（中身は3行）

  楽器を足すとき:
    1. このファイルの 'instruments' に追加
    2. config/{楽器}.php を作る
    3. includes/lang/*.php の 'instrument' に楽器名を追加
    4. /{言語}/{楽器}/index.php を言語の数だけ作る
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }

return [
  /* アプリの正式名称。ブランド表記なので言語共通・翻訳しない */
  'name'               => 'GEN strings',

  'langs'              => ['ja', 'en', 'es', 'zh'],
  'instruments'        => ['violin', 'viola', 'cello', 'contrabass'],
  /* 一覧に無い値が来たときの既定。ルートの / からの転送先もこの組み合わせ */
  'default_lang'       => 'ja',
  'default_instrument' => 'cello',

  /* Google アナリティクス（GA4）の測定ID。空文字にすると計測タグを出力しない
     （ローカルや検証用のコピーで数字を汚したくないときは空にする） */
  'ga_id'              => 'G-KSBPPQHTT9',

  /* お問い合わせの宛先（転送専用アドレス）。件名の頭には上の 'name' が付く */
  'contact_to'         => 'mail@genstrings.sakura.ne.jp',

  /* 管理者（マスターアカウント）のメールアドレス。
     このアドレスでログインしている人にだけ、歯車（設定）の中に「共有曲の管理」が出る。
     共有された曲を非公開にしたり削除したりできるのはこのアカウントだけ。
     空文字にすると管理メニューは誰にも出ない。 */
  'admin_email'        => 'mpas585@gmail.com',

  /* アカウント・設定の保存の SQLite ファイル。
     公開ディレクトリの外に置ける契約なら、ここを絶対パスにして data/ ごと外へ移すこと。
     例: '/home/（アカウント）/db/genstrings.db' */
  'db_path'            => __DIR__ . '/../data/app.db',

  /* ===== アカウント（メールアドレス＋パスワード / Google ログイン） =====
     site_url … 確認メール・再発行メールに載せるリンクの起点。末尾スラッシュ無し。
                空にすると実行中のリクエストから組み立てる（通常はそれで足りる）。
     mail_from … 送信元。さくらの場合はこのドメインのアドレスにしないと弾かれる。
     mail_from_name … 送信者名。日本語可（送信時に MIME エンコードする）。 */
  'site_url'           => '',
  'mail_from'          => 'no-reply@genstrings.sakura.ne.jp',
  'mail_from_name'     => 'GEN strings',

  /* Google ログイン。Google Cloud Console の「OAuth 2.0 クライアント ID」（種類：ウェブ アプリケーション）で発行する。
     承認済みのリダイレクト URI には、このサイトの /oauth/google.php を登録すること。
       例: https://genstrings.sakura.ne.jp/oauth/google.php
     どちらかが空文字のあいだは「Google で続ける」ボタンを出さない（＝メールログインだけで動く）。 */
  'google_client_id'     => '',
  'google_client_secret' => '',
];
