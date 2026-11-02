const ordinals = ["TH", "ST", "ND", "RD"];

export function ordinal(position: number): string {
  const teen = position % 100 >= 11 && position % 100 <= 13;
  return teen ? "TH" : (ordinals[position % 10] ?? "TH");
}
