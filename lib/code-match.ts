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
  const actual = tokens(submitted).slice(0, 3000);
  const expected = tokens(reference).slice(0, 3000);
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
