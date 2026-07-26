<?php
/*
  api/contact.php — お問い合わせフォームの送信先（JSON API）。

    POST  name= email= body= lang=  （+ 見えない罠フィールド website=）

  宛先は config/app.php の 'contact_to'（転送専用アドレス）。
  件名には必ずアプリ名（GEN strings）を入れる＝転送先で判別できるようにするため。
  差出人は自ドメインのアドレスにする（さくらでは From が自ドメインでないと弾かれる）。
  返信は Reply-To に入れた本人宛に返る。
*/
define('STRING_APP', 1);
define('APP_ROOT', dirname(__DIR__));

$LANG      = $_POST['lang'] ?? '';
$URL_DEPTH = 1;
require APP_ROOT . '/includes/bootstrap.php';

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');

function out(array $a): void {
  echo json_encode($a, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}
function cerr(string $code, ...$args): void {
  out(['ok' => false, 'error' => $code, 'message' => t('contact.err.' . $code, ...$args)]);
}
/* ヘッダに改行を入れられると別宛先を足せてしまう（メールヘッダインジェクション） */
function clean_header(string $s): string {
  return trim(str_replace(["\r", "\n", "\0"], '', $s));
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST')         { http_response_code(405); cerr('method'); }
if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'fetch') { http_response_code(403); cerr('method'); }
$o = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($o !== '' && $origin !== '' && $o !== $origin)         { http_response_code(403); cerr('method'); }

/* 罠フィールド。人間には見えない入力欄なので、埋まっていれば機械 */
if (trim((string)($_POST['website'] ?? '')) !== '') { out(['ok' => true, 'message' => t('contact.ok')]); }

$name  = clean_header((string)($_POST['name']  ?? ''));
$email = clean_header((string)($_POST['email'] ?? ''));
$body  = trim((string)($_POST['body'] ?? ''));

if ($name === '' || $body === '')                            cerr('empty');
if (mb_strlen($name, 'UTF-8') > 60)                          cerr('long');
if (mb_strlen($body, 'UTF-8') > 4000)                        cerr('long');
if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) cerr('email');

/* 連続送信よけ（同一セッションから60秒に1通） */
if (session_status() !== PHP_SESSION_ACTIVE) { session_name('gsid'); @session_start(); }
$last = (int)($_SESSION['contact_at'] ?? 0);
if ($last && (time() - $last) < 60) cerr('toofast');

mb_language('uni');
mb_internal_encoding('UTF-8');

$subject = '[' . APP_NAME . '] ' . t('contact.mail_subject', $name);
$lines = [
  t('contact.mail_name')  . ': ' . $name,
  t('contact.mail_email') . ': ' . ($email !== '' ? $email : '-'),
  t('contact.mail_lang')  . ': ' . $LANG,
  t('contact.mail_page')  . ': ' . clean_header((string)($_POST['page'] ?? ($_SERVER['HTTP_REFERER'] ?? '-'))),
  'UA: ' . clean_header(mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? '-'), 0, 200)),
  'IP: ' . clean_header((string)($_SERVER['REMOTE_ADDR'] ?? '-')),
  '',
  '----------------------------------------',
  $body,
  '----------------------------------------',
];

$headers = 'From: ' . mb_encode_mimeheader(APP_NAME, 'UTF-8') . ' <' . APP_CONTACT_TO . '>' . "\r\n";
if ($email !== '') { $headers .= 'Reply-To: ' . $email . "\r\n"; }
$headers .= 'X-Mailer: GEN strings contact form';

$ok = @mb_send_mail(APP_CONTACT_TO, $subject, implode("\n", $lines), $headers, '-f' . APP_CONTACT_TO);

if (!$ok) {
  error_log('[GEN strings contact] mail() failed');
  http_response_code(500);
  cerr('send');
}

$_SESSION['contact_at'] = time();
out(['ok' => true, 'message' => t('contact.ok')]);
