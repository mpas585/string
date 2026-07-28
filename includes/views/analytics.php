<?php
/*
  views/analytics.php — Google アナリティクス（GA4）の計測タグ。
  呼び出し元: views/app.php / views/home.php / views/soon.php の <head> 冒頭。

  測定IDは config/app.php の 'ga_id' 1か所だけ（空にすれば何も出力しない）。
  ※ Service Worker は googletagmanager / google-analytics を素通しさせている（sw.js）。
     ここを通してしまうと計測ビーコンがキャッシュ優先になり、送信が握り潰される。
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }
if (!defined('APP_GA_ID') || APP_GA_ID === '') return;
?>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=<?= h(APP_GA_ID) ?>"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', '<?= h(APP_GA_ID) ?>');
</script>
