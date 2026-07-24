<?php
/*
  /{言語}/ — 楽器の指定が無いので既定楽器（config/app.php）へ転送する。
*/
define('STRING_APP', 1);
$APP = require __DIR__ . '/../config/app.php';
header('Location: ./' . $APP['default_instrument'] . '/', true, 302);
exit;
