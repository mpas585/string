"""includes/lang/{lang}.php の return 配列を JSON へ変換する。

index.html は PHP を通さないので window.T が無く、tt() が 'msg.xxx' というキー名を
そのまま返してしまう。PHP 版と同じ辞書を index.html にも埋め込むために使う。

使い方:
    python tools/langjson.py includes/lang/ja.php             → JSON を標準出力へ
    python tools/langjson.py includes/lang/ja.php --check      → 読めるかどうかだけ確かめる
    python tools/langjson.py includes/lang/*.php --parity      → 言語間でキーがそろっているか見る

対応する構文（lang ファイルが使う範囲＋よくある書き足し）:
    'key' => '値',                シングルクォート文字列（\\' と \\\\ のみエスケープ）
    'key' => "値",                ダブルクォート文字列（\\n \\t \\" \\\\ \\u{...} \\x.. を解釈）
    'key' => 'あ' . 'い',          「.」でつないだ文字列（つないだ結果を1つの文字列にする）
    'key' => <<<TXT ... TXT;      ヒアドキュメント／ナウドキュメント（<<<'TXT'）
    'key' => [ ... ],             連想配列
    [ 'a', 'b' ],                 添字配列
    'key' => true / false / null / 数値
    末尾のカンマ、/* */ と // と # のコメント

読めない書き方（定数・関数呼び出し・変数の埋め込みなど）に当たったときは、
何行目の何が読めなかったかを添えて止める。黙って途中で終わらないようにしてある。
"""
import re
import json
import sys
import glob


class LangSyntaxError(Exception):
    pass


class P:
    def __init__(self, s, path='(input)'):
        self.s = s
        self.i = 0
        self.path = path

    # ---- 位置と、読めなかった理由 ----
    def where(self, i=None):
        """今見ている場所を「◯行目◯桁」で返す。行番号が出ないと直しようがないため。"""
        i = self.i if i is None else i
        line = self.s.count('\n', 0, i) + 1
        col = i - (self.s.rfind('\n', 0, i) + 1) + 1
        return line, col

    def die(self, why, i=None):
        i = self.i if i is None else i
        line, col = self.where(i)
        near = self.s[i:i + 60].replace('\n', '\\n')
        raise LangSyntaxError(
            '%s の %d行目 %d桁: %s\n  ここから読めません: %s' % (self.path, line, col, why, near))

    def eof(self):
        return self.i >= len(self.s)

    def cur(self):
        """今の1文字。ファイルの終わりに当たったときも、黙って止まらずに理由を出す。"""
        if self.eof():
            self.die("ファイルの終わりに来ました（] や ' の閉じ忘れがありそうです）")
        return self.s[self.i]

    # ---- 空白とコメント ----
    def ws(self):
        while self.i < len(self.s):
            c = self.s[self.i]
            if c in ' \t\r\n':
                self.i += 1
            elif self.s.startswith('/*', self.i):
                j = self.s.find('*/', self.i + 2)
                if j < 0:
                    self.die('/* を閉じる */ がありません')
                self.i = j + 2
            elif self.s.startswith('//', self.i) or c == '#':
                j = self.s.find('\n', self.i)
                self.i = len(self.s) if j < 0 else j + 1
            else:
                return

    # ダブルクォート内で意味を持つエスケープ（PHP のマニュアルの範囲）
    DQ = {'n': '\n', 't': '\t', 'r': '\r', 'v': '\v', 'f': '\f',
          'e': '\x1b', '\\': '\\', '"': '"', '$': '$'}

    # ---- 文字列 ----
    def string(self):
        q = self.cur()
        if q not in ("'", '"'):
            self.die('文字列の始まりではありません')
        start = self.i
        self.i += 1
        out = []
        while True:
            if self.eof():
                self.die('文字列が %s で閉じられていません' % q, start)
            c = self.s[self.i]
            if c == '\\':
                if self.i + 1 >= len(self.s):
                    self.die('\\ のうしろが空です')
                nxt = self.s[self.i + 1]
                if q == "'":
                    # シングルクォートは \' と \\ だけが特別。他は文字どおり残す
                    out.append(nxt if nxt in ("'", '\\') else '\\' + nxt)
                    self.i += 2
                    continue
                # 以下ダブルクォート
                if nxt == 'u' and self.s[self.i + 2:self.i + 3] == '{':
                    j = self.s.find('}', self.i)
                    if j < 0:
                        self.die('\\u{ を閉じる } がありません')
                    out.append(chr(int(self.s[self.i + 3:j], 16)))
                    self.i = j + 1
                elif nxt == 'x':
                    m = re.match(r'[0-9A-Fa-f]{1,2}', self.s[self.i + 2:])
                    if m:
                        out.append(chr(int(m.group(0), 16)))
                        self.i += 2 + m.end()
                    else:
                        out.append('\\x')
                        self.i += 2
                elif nxt in self.DQ:
                    out.append(self.DQ[nxt])
                    self.i += 2
                else:
                    # 意味を持たないエスケープは、PHP ではバックスラッシュごと残る
                    out.append('\\' + nxt)
                    self.i += 2
            elif c == q:
                self.i += 1
                return ''.join(out)
            else:
                # ダブルクォートの中の $変数 は PHP 側で展開されてしまう。
                # 気付かずに書いてあると JSON と食い違うので、ここで止める。
                if q == '"' and c == '$' and re.match(r'\$[A-Za-z_{]', self.s[self.i:]):
                    self.die('ダブルクォートの中の $ は変数として展開されます。'
                             "シングルクォートにするか \\$ と書いてください")
                out.append(c)
                self.i += 1

    def heredoc(self):
        """<<<TXT ... TXT; と <<<'TXT' ... TXT;（ナウドキュメント）。"""
        m = re.match(r"<<<[ \t]*(?:'(?P<nd>[A-Za-z_]\w*)'|\"?(?P<hd>[A-Za-z_]\w*)\"?)\r?\n",
                     self.s[self.i:])
        if not m:
            self.die('ヒアドキュメントの始まりが読めません')
        label = m.group('nd') or m.group('hd')
        nowdoc = m.group('nd') is not None
        self.i += m.end()
        # 終わりの行（PHP 7.3 以降は字下げできる）
        end = re.compile(r'^(?P<ind>[ \t]*)' + re.escape(label) + r'(?![A-Za-z0-9_])',
                         re.MULTILINE)
        m2 = end.search(self.s, self.i)
        if not m2:
            self.die('ヒアドキュメント %s を閉じる行がありません' % label)
        body = self.s[self.i:m2.start()]
        if body.endswith('\n'):
            body = body[:-1]
        if body.endswith('\r'):
            body = body[:-1]
        ind = m2.group('ind')
        if ind:
            body = '\n'.join(l[len(ind):] if l.startswith(ind) else l.lstrip()
                             for l in body.split('\n'))
        self.i = m2.end()
        if nowdoc:
            return body
        # ヒアドキュメントはダブルクォートと同じ扱い。エスケープだけ解いておく
        return re.sub(r'\\(.)', lambda mm: self.DQ.get(mm.group(1), '\\' + mm.group(1)), body)

    # ---- 値 ----
    def value(self):
        v = self.one()
        # 「.」でつないだ文字列。'あ' . 'い' のように書いてあっても1つにまとめる
        while True:
            save = self.i
            self.ws()
            if not self.eof() and self.s[self.i] == '.' and not self.s.startswith('...', self.i):
                self.i += 1
                rhs = self.one()
                if not isinstance(v, str) or not isinstance(rhs, str):
                    self.die('「.」でつなげるのは文字列だけです')
                v = v + rhs
            else:
                self.i = save
                return v

    def one(self):
        self.ws()
        c = self.cur()
        if c in ("'", '"'):
            return self.string()
        if c == '[':
            return self.array()
        if self.s.startswith('<<<', self.i):
            return self.heredoc()
        if self.s.startswith('array(', self.i):
            self.die('array( ... ) 形式は読めません。[ ... ] で書いてください')
        m = re.match(r'(true|false|null|-?\d+(?:\.\d+)?)(?![A-Za-z0-9_])',
                     self.s[self.i:], re.IGNORECASE)
        if m:
            self.i += m.end()
            t = m.group(1)
            low = t.lower()
            if low in ('true', 'false', 'null'):
                return {'true': True, 'false': False, 'null': None}[low]
            return float(t) if '.' in t else int(t)
        # 定数・関数呼び出し・変数はここへ来る。何が書いてあるかを添えて止める
        m = re.match(r'[A-Za-z_$\\][\w$\\]*', self.s[self.i:])
        if m:
            self.die("'%s' は文字列ではありません（定数・変数・関数は辞書に書けません）" % m.group(0))
        self.die('値が読めません')

    def array(self):
        start = self.i
        if self.cur() != '[':
            self.die('[ ではありません')
        self.i += 1
        items, obj = [], {}
        while True:
            self.ws()
            if self.eof():
                self.die('[ を閉じる ] がありません', start)
            if self.s[self.i] == ']':
                self.i += 1
                # 中身が空のときは空の添字配列として扱う（PHP でも [] は空配列）
                return obj if obj else items
            k = self.value()
            self.ws()
            if self.s.startswith('=>', self.i):
                self.i += 2
                if not isinstance(k, (str, int)):
                    self.die('キーに使えるのは文字列か整数だけです')
                key = str(k)
                if key in obj:
                    line, _ = self.where()
                    sys.stderr.write("警告: %s の %d行目あたり: キー '%s' が重複しています"
                                     "（あとに書いたほうが残ります）\n" % (self.path, line, key))
                obj[key] = self.value()
            else:
                if obj:
                    self.die('キーのある要素と無い要素が混ざっています')
                items.append(k)
            self.ws()
            if self.eof():
                self.die('[ を閉じる ] がありません', start)
            if self.s[self.i] == ',':
                self.i += 1
            elif self.s[self.i] != ']':
                self.die('要素のあいだに , がありません')


def load(path):
    with open(path, encoding='utf-8') as f:
        s = f.read()
    p = P(s, path)
    j = s.find('return')
    if j < 0:
        raise LangSyntaxError('%s に return がありません' % path)
    p.i = j + len('return')
    p.ws()
    if p.eof() or p.s[p.i] != '[':
        line, col = p.where()
        raise LangSyntaxError('%s の %d行目 %d桁: return のうしろが [ ではありません' % (path, line, col))
    return p.array()


# ---- 言語間でキーがそろっているか ----
def flat_keys(d, prefix=''):
    out = []
    if isinstance(d, dict):
        for k, v in d.items():
            out += flat_keys(v, prefix + '.' + str(k))
    elif isinstance(d, list):
        for i, v in enumerate(d):
            out += flat_keys(v, prefix + '[%d]' % i)
    else:
        out.append(prefix)
    return out


def main(argv):
    args = [a for a in argv[1:] if not a.startswith('--')]
    opts = set(a for a in argv[1:] if a.startswith('--'))
    paths = []
    for a in args:
        paths += sorted(glob.glob(a)) or [a]
    if not paths:
        sys.stderr.write(__doc__)
        return 2

    loaded = {}
    for p in paths:
        try:
            loaded[p] = load(p)
        except LangSyntaxError as e:
            sys.stderr.write('読めませんでした:\n%s\n' % e)
            return 1
        except OSError as e:
            sys.stderr.write('開けませんでした: %s\n' % e)
            return 1

    if '--parity' in opts:
        base = paths[0]
        bk = flat_keys(loaded[base])
        bs = set(bk)
        print('%s: %d キー' % (base, len(bk)))
        ng = 0
        for p in paths[1:]:
            ks = set(flat_keys(loaded[p]))
            miss, extra = sorted(bs - ks), sorted(ks - bs)
            print('%s: 足りない %d / 余分 %d' % (p, len(miss), len(extra)))
            for k in miss[:20]:
                print('   - %s' % k)
            for k in extra[:20]:
                print('   + %s' % k)
            ng += len(miss) + len(extra)
        return 1 if ng else 0

    if '--check' in opts:
        for p in paths:
            print('%s: OK (%d キー)' % (p, len(flat_keys(loaded[p]))))
        return 0

    for p in paths:
        print(json.dumps(loaded[p], ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
