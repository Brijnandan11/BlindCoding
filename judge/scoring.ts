import { codeMatchPercent, tokens } from "../lib/code-match";

export { tokens };
export function similarity(a: string, b: string) {
  return codeMatchPercent(a, b) / 100;
}
