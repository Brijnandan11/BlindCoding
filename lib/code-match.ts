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
  // Only rename identifiers declared as variables. Renaming every unknown word
  // made arbitrary text look like valid variable-renamed code.
  const variableNames = (sourceTokens: string[]) => {
    const types = new Set(["int", "char", "float", "double", "short", "long", "signed", "unsigned", "bool", "_Bool"]);
    const variables = new Set<string>();
    for (let i = 0; i < sourceTokens.length - 1; i++) {
      if (!types.has(sourceTokens[i])) continue;
      let expectName = true;
      for (let j = i + 1; j < sourceTokens.length && sourceTokens[j] !== ";"; j++) {
        if (sourceTokens[j] === "(" && j === i + 2) break; // function declaration
        if (expectName && /^[A-Za-z_]\w*$/.test(sourceTokens[j])) {
          variables.add(sourceTokens[j]);
          expectName = false;
        } else if (sourceTokens[j] === ",") {
          expectName = true;
        } else if (sourceTokens[j] === "=") {
          while (j + 1 < sourceTokens.length && sourceTokens[j + 1] !== "," && sourceTokens[j + 1] !== ";") j++;
        }
      }
    }
    return variables;
  };
  const canonicalize = (sourceTokens: string[], variables: Set<string>) => {
    const names = new Map<string, string>();
    let next = 0;
    return sourceTokens.map((token) => {
      if (!variables.has(token)) return token;
      let canonical = names.get(token);
      if (!canonical) {
        canonical = `__variable_${next++}`;
        names.set(token, canonical);
      }
      return canonical;
    });
  };
  const actual = canonicalize(rawActual, variableNames(rawActual));
  const expected = canonicalize(rawExpected, variableNames(rawExpected));
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
