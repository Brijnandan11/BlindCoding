// Compare code token sequences while ignoring whitespace and comments.
// The score is a structural match percentage, not a compiler/test score.
export function tokens(source: string) {
  return (
    source
      .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, " ")
      .match(
        /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_]\w*|\d+(?:\.\d+)?|==|!=|<=|>=|\+\+|--|\+=|-=|&&|\|\||[^\s]/g,
      ) || []
  );
}

export function codeMatchPercent(submitted: string, reference: string) {
  const rawActual = tokens(submitted).slice(0, 3000);
  const rawExpected = tokens(reference).slice(0, 3000);
  // Normalize user-defined identifiers by first appearance. This makes consistent
  // renaming (for example first/second/third to a/b/c) score as the same code,
  // while keywords and built-in names remain exact.
  const keywords = new Set([
    "auto", "break", "case", "char", "const", "continue", "default", "do",
    "double", "else", "enum", "extern", "float", "for", "goto", "if",
    "inline", "int", "long", "register", "restrict", "return", "short",
    "signed", "sizeof", "static", "struct", "switch", "typedef", "union",
    "unsigned", "void", "volatile", "while", "_Bool", "_Complex", "_Imaginary",
    "alignas", "alignof", "and", "asm", "bool", "catch", "class", "constexpr",
    "cout", "cin", "decltype", "delete", "false", "namespace", "new", "nullptr",
    "operator", "private", "public", "std", "string", "template", "this", "true",
    "try", "using", "virtual", "#include", "printf", "scanf",
  ]);
  const canonicalize = (sourceTokens: string[], otherTokens: string[]) => {
    const names = new Map<string, string>();
    const reserved = new Set([...keywords, ...sourceTokens.filter((t) => !/^[A-Za-z_]\w*$/.test(t)), ...otherTokens.filter((t) => !/^[A-Za-z_]\w*$/.test(t))]);
    let next = 0;
    return sourceTokens.map((token) => {
      if (!/^[A-Za-z_]\w*$/.test(token) || keywords.has(token)) return token;
      let canonical = names.get(token);
      if (!canonical) {
        do canonical = `__identifier_${next++}`; while (reserved.has(canonical));
        names.set(token, canonical);
      }
      return canonical;
    });
  };
  const actual = canonicalize(rawActual, rawExpected);
  const expected = canonicalize(rawExpected, rawActual);
  if (!actual.length && !expected.length) return 100;

  const lengths = new Uint16Array(expected.length + 1);
  for (const token of actual) {
    let previousDiagonal = 0;
    for (let index = 1; index <= expected.length; index++) {
      const previous = lengths[index];
      lengths[index] = token === expected[index - 1]
        ? previousDiagonal + 1
        : Math.max(lengths[index], lengths[index - 1]);
      previousDiagonal = previous;
    }
  }
  return (200 * lengths[expected.length]) / Math.max(1, actual.length + expected.length);
}
