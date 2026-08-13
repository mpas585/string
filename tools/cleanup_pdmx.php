<?php
/**
 * cleanup_pdmx.php  —  PDMX由来（pd_*.json）の楽曲ファイルを削除する使い捨てスクリプト。
 *
 * 使い方:
 *   1) ブラウザで tools/cleanup_pdmx.php を開く  → 削除対象の一覧が表示される（ドライラン）
 *   2) tools/cleanup_pdmx.php?confirm=1 を開く    → 実際に削除を実行
 *   3) 実行後はこのファイルを必ず削除すること。
 *
 * manifest.json からエントリを外すだけでもアプリ上は非表示になりますが、
 * サーバー上の pd_*.json 実体を消したい場合にこれを使います。
 * ※ config/app.php / spp.php には一切触れません。
 */

header('Content-Type: text/plain; charset=UTF-8');

$songsDir = realpath(__DIR__ . '/../public/songs');
if ($songsDir === false || !is_dir($songsDir)) {
    http_response_code(500);
    echo "songs ディレクトリが見つかりません: " . __DIR__ . "/../public/songs\n";
    exit;
}

$confirm = isset($_GET['confirm']) && $_GET['confirm'] === '1';

$files = glob($songsDir . '/pd_*.json');
sort($files);

echo "対象ディレクトリ: {$songsDir}\n";
echo "pd_*.json の件数: " . count($files) . "\n";
echo $confirm ? "モード: 実削除\n" : "モード: ドライラン（削除しません。実行するには ?confirm=1 を付けてください）\n";
echo str_repeat('-', 40) . "\n";

$deleted = 0; $failed = 0;
foreach ($files as $f) {
    $name = basename($f);
    // 念のため二重チェック: pd_ で始まり .json で終わるものだけ
    if (strpos($name, 'pd_') !== 0 || substr($name, -5) !== '.json') {
        echo "SKIP (対象外): {$name}\n";
        continue;
    }
    if ($confirm) {
        if (@unlink($f)) { echo "DELETED: {$name}\n"; $deleted++; }
        else            { echo "FAILED : {$name}\n"; $failed++; }
    } else {
        echo "WILL DELETE: {$name}\n";
    }
}

echo str_repeat('-', 40) . "\n";
if ($confirm) {
    echo "削除完了: {$deleted} 件";
    if ($failed) echo " / 失敗: {$failed} 件";
    echo "\nこのスクリプト(tools/cleanup_pdmx.php)は削除してください。\n";
} else {
    echo "ドライラン終了。実削除するには ?confirm=1 を付けて再実行してください。\n";
}
