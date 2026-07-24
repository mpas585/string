<?php
/*
  sitemap.php — config/app.php の 言語 × 楽器 から sitemap を生成する。
  ・ready=false の楽器（準備中ページ）は noindex なので出力しない
  ・各URLに全言語の xhtml:link を付ける（hreflang をサイトマップ側でも明示）
  ・既定楽器には x-default（＝Accept-Language で振り分けるルート）を付ける

  参照のさせ方: ドメイン直下の robots.txt に
      Sitemap: https://（ドメイン）/cello-finger/sitemap.php
  と書くか、Search Console にこのURLを登録する。
  拡張子を .xml にしたい場合は .htaccess に
      RewriteEngine On
      RewriteRule ^sitemap\.xml$ sitemap.php [L]
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

$url = function ($lang, $inst) use ($origin, $root) {
  return $origin . $root . '/' . $lang . '/' . $inst . '/';
};
$x = function ($s) { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); };

header('Content-Type: application/xml; charset=UTF-8');
echo '<?xml version="1.0" encoding="UTF-8"?>', "\n";
?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
<?php foreach ($instruments as $inst): ?>
<?php foreach ($APP['langs'] as $lang): ?>
  <url>
    <loc><?= $x($url($lang, $inst)) ?></loc>
<?php foreach ($APP['langs'] as $alt): ?>
    <xhtml:link rel="alternate" hreflang="<?= $x($alt) ?>" href="<?= $x($url($alt, $inst)) ?>"/>
<?php endforeach; ?>
<?php if ($inst === $APP['default_instrument']): ?>
    <xhtml:link rel="alternate" hreflang="x-default" href="<?= $x($origin . $root . '/') ?>"/>
<?php endif; ?>
  </url>
<?php endforeach; ?>
<?php endforeach; ?>
</urlset>
