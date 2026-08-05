<?php
/*
  sitemap.php — config/app.php の 言語 × 楽器 から sitemap を生成する。
  ・/{言語}/（楽器選択トップ）と /{言語}/{楽器}/（アプリ）の両方を出力する
  ・ready=false の楽器（準備中ページ）は noindex なので出力しない
  ・各URLに全言語の xhtml:link を付ける（hreflang をサイトマップ側でも明示）
  ・既定楽器には x-default（＝Accept-Language で振り分けるルート）を付ける

  参照のさせ方: ドメイン直下の robots.txt に
      Sitemap: https://genstrings.sakura.ne.jp/sitemap.xml
  と書くか、Search Console にこのURLを登録する。
  /sitemap.xml → sitemap.php の書き換えはルートの .htaccess に入れてある。
*/
define('STRING_APP', 1);
$APP = require __DIR__ . '/config/app.php';

$https  = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
       || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
$origin = ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? '');
$root   = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');

/* 公開済み（ready=true）の楽器だけを対象にする */
$instruments = [];
foreach ($APP['instruments'] as $i) {
  $c = require __DIR__ . '/config/' . $i . '.php';
  if (!empty($c['ready'])) { $instruments[] = $i; }
}

$url = function ($lang, $inst = '', $sub = '') use ($origin, $root) {
  return $origin . $root . '/' . $lang . '/' . ($inst === '' ? '' : $inst . '/') . ($sub === '' ? '' : $sub . '/');
};
$x = function ($s) { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); };

header('Content-Type: application/xml; charset=UTF-8');
echo '<?xml version="1.0" encoding="UTF-8"?>', "\n";
?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
<?php /* 1) 言語別トップ（楽器選択）。x-default は言語判定して振り分けるルート */ ?>
<?php foreach ($APP['langs'] as $lang): ?>
  <url>
    <loc><?= $x($url($lang)) ?></loc>
<?php foreach ($APP['langs'] as $alt): ?>
    <xhtml:link rel="alternate" hreflang="<?= $x($alt) ?>" href="<?= $x($url($alt)) ?>"/>
<?php endforeach; ?>
    <xhtml:link rel="alternate" hreflang="x-default" href="<?= $x($origin . $root . '/') ?>"/>
    <priority>1.0</priority>
  </url>
<?php endforeach; ?>
<?php /* 1.5) プライバシーポリシー（/{言語}/privacy/ ＝ includes/views/legal.php） */ ?>
<?php foreach ($APP['langs'] as $lang): ?>
  <url>
    <loc><?= $x($origin . $root . '/' . $lang . '/privacy/') ?></loc>
<?php foreach ($APP['langs'] as $alt): ?>
    <xhtml:link rel="alternate" hreflang="<?= $x($alt) ?>" href="<?= $x($origin . $root . '/' . $alt . '/privacy/') ?>"/>
<?php endforeach; ?>
    <priority>0.3</priority>
  </url>
<?php endforeach; ?>
<?php /* 1.6) 利用規約（/{言語}/terms/ ＝ includes/views/terms.php） */ ?>
<?php foreach ($APP['langs'] as $lang): ?>
  <url>
    <loc><?= $x($origin . $root . '/' . $lang . '/terms/') ?></loc>
<?php foreach ($APP['langs'] as $alt): ?>
    <xhtml:link rel="alternate" hreflang="<?= $x($alt) ?>" href="<?= $x($origin . $root . '/' . $alt . '/terms/') ?>"/>
<?php endforeach; ?>
    <priority>0.3</priority>
  </url>
<?php endforeach; ?>
<?php /* 2) 楽器ごとのアプリ本体 */ ?>
<?php foreach ($instruments as $inst): ?>
<?php foreach ($APP['langs'] as $lang): ?>
  <url>
    <loc><?= $x($url($lang, $inst)) ?></loc>
<?php foreach ($APP['langs'] as $alt): ?>
    <xhtml:link rel="alternate" hreflang="<?= $x($alt) ?>" href="<?= $x($url($alt, $inst)) ?>"/>
<?php endforeach; ?>
    <priority>0.8</priority>
  </url>
<?php endforeach; ?>
<?php endforeach; ?>
<?php /* 3) 楽器ごとのお悩み集（/{言語}/{楽器}/guide/ ＝ includes/views/guide.php） */ ?>
<?php foreach ($instruments as $inst): ?>
<?php foreach ($APP['langs'] as $lang): ?>
  <url>
    <loc><?= $x($url($lang, $inst, 'guide')) ?></loc>
<?php foreach ($APP['langs'] as $alt): ?>
    <xhtml:link rel="alternate" hreflang="<?= $x($alt) ?>" href="<?= $x($url($alt, $inst, 'guide')) ?>"/>
<?php endforeach; ?>
    <priority>0.6</priority>
  </url>
<?php endforeach; ?>
<?php endforeach; ?>
</urlset>
