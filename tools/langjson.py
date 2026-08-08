"""includes/lang/{lang}.php の return 配列を JSON へ変換する。

index.html は PHP を通さないので window.T が無く、tt() が 'msg.xxx' というキー名を
そのまま返してしまう。PHP 版と同じ辞書を index.html にも埋め込むために使う。
対応する構文は lang ファイルが実際に使っている範囲だけ:
  'key' => '値',            (シングルクォート文字列。\\' と \\\\ のみエスケープ)
  'key' => "値",            (ダブルクォート文字列。\\n \\t \\" \\\\ などを解釈する)
  'key' => [ ... ],         (連想配列)
  [ 'a', 'b' ],             (添字配列)
"""
import re
import json
import sys


class P:
    def __init__(self, s):
        self.s = s
        self.i = 0

    def ws(self):
        while self.i < len(self.s):
            c = self.s[self.i]
            if c in ' \t\r\n':
                self.i += 1
            elif self.s.startswith('/*', self.i):
                j = self.s.index('*/', self.i)
                self.i = j + 2
            elif self.s.startswith('//', self.i):
                j = self.s.find('\n', self.i)
                self.i = len(self.s) if j < 0 else j + 1
            else:
                return

    # ダブルクォート内で意味を持つエスケープ（PHP のマニュアルの範囲）
    DQ = {'n': '\n', 't': '\t', 'r': '\r', 'v': '\v', 'f': '\f',
          'e': '\x1b', '\\': '\\', '"': '"', '$': '$'}

    def string(self):
        q = self.s[self.i]
        assert q in ("'", '"'), self.s[self.i - 30:self.i + 30]
        self.i += 1
        out = []
        while True:
            c = self.s[self.i]
            if c == '\\':
                nxt = self.s[self.i + 1]
                if q == "'":
                    # シングルクォートは \\' と \\\\ だけが特別。他は文字どおり残す
                    out.append(nxt if nxt in ("'", '\\') else '\\' + nxt)
                    self.i += 2
                    continue
                # 以下ダブルクォート
                if nxt == 'u' and self.s[self.i + 2:self.i + 3] == '{':
                    j = self.s.index('}', self.i)
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
                out.append(c)
                self.i += 1

    def value(self):
        self.ws()
        if self.s[self.i] in ("'", '"'):
            return self.string()
        if self.s[self.i] == '[':
            return self.array()
        m = re.match(r'(true|false|null|-?\d+(?:\.\d+)?)', self.s[self.i:])
        if m:
            self.i += m.end()
            t = m.group(1)
            return {'true': True, 'false': False, 'null': None}.get(
                t, float(t) if '.' in t else int(t))
        raise SyntaxError('値が読めない: ' + repr(self.s[self.i:self.i + 40]))

    def array(self):
        assert self.s[self.i] == '['
        self.i += 1
        items, obj = [], {}
        while True:
            self.ws()
            if self.s[self.i] == ']':
                self.i += 1
                return obj if obj else items
            v = self.value()
            self.ws()
            if self.s.startswith('=>', self.i):
                self.i += 2
                obj[v] = self.value()
            else:
                items.append(v)
            self.ws()
            if self.s[self.i] == ',':
                self.i += 1


def load(path):
    s = open(path, encoding='utf-8').read()
    p = P(s)
    p.i = s.index('return [') + len('return ')
    return p.array()


if __name__ == '__main__':
    d = load(sys.argv[1])
    print(json.dumps(d, ensure_ascii=False, indent=2))
