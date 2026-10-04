import React, { useMemo } from 'react';

/**
 * A tiny dependency-free JavaScript highlighter.
 *
 * Regex order matters: comments and strings must win before keywords, otherwise
 * a keyword inside a string would be highlighted.
 */
const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'of', 'in',
  'new', 'class', 'extends', 'import', 'from', 'export', 'default', 'async', 'await',
  'try', 'catch', 'finally', 'throw', 'switch', 'case', 'break', 'continue', 'this',
  'super', 'typeof', 'instanceof', 'null', 'undefined', 'true', 'false', 'delete', 'void',
  'yield', 'static', 'get', 'set',
]);

const PATTERNS = [
  ['com', /\/\/[^\n]*/y],
  ['com', /\/\*[\s\S]*?\*\//y],
  ['str', /'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"/y],
  ['key', /\b(?:const|let|var|function|return|if|else|for|while|of|in|new|class|extends|import|from|export|default|async|await|try|catch|finally|throw|switch|case|break|continue|typeof|instanceof|delete|void|yield|static|get|set)\b/y],
  ['kw', /\b(?:this|super|null|undefined|true|false)\b/y],
  ['num', /\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/y],
  ['fn', /[A-Za-z_$][\w$]*(?=\s*\()/y],
];

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function highlight(code) {
  let out = '';
  let i = 0;

  while (i < code.length) {
    let matched = false;

    for (const [kind, regex] of PATTERNS) {
      regex.lastIndex = i;
      const m = regex.exec(code);
      if (m && m.index === i && m[0].length > 0) {
        out += `<span class="tok-${kind}">${escapeHtml(m[0])}</span>`;
        i += m[0].length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      out += escapeHtml(code[i]);
      i += 1;
    }
  }

  return out;
}

export function CodeBlock({ code, className = '' }) {
  const html = useMemo(() => (code ? highlight(code) : ''), [code]);

  return (
    <pre className={`code ${className}`}>
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}