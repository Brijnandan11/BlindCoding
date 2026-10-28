// Token-sequence similarity ignores whitespace and comments. This is a transparent
// structural approximation, not an AST/semantic equivalence claim.
export function tokens(source: string) {
  return (
    source
      .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, " ")
      .match(
        /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_]\w*|\d+(?:\.\d+)?|==|!=|<=|>=|\+\+|--|\+=|-=|&&|\|\||[^\s]/g,
      ) || []
  );
}
export function similarity(a: string, b: string) {
  const x = tokens(a).slice(0, 3000),
    y = tokens(b).slice(0, 3000);
  if (!x.length && !y.length) return 1;
  const dp = new Uint16Array(y.length + 1);
  for (const token of x) {
    let prev = 0;
    for (let j = 1; j <= y.length; j++) {
      const old = dp[j];
      dp[j] = token === y[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = old;
    }
  }
  return (2 * dp[y.length]) / Math.max(1, x.length + y.length);
}
