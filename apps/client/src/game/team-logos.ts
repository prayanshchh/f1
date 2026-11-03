const marks: Record<string, string> = {
  velza: "M6 6h14l12 20L44 6h14L38 36H26Z",
  meridian:
    "M32 3a17 17 0 1 0 0 34 17 17 0 0 0 0-34Zm0 4c2.6 0 6 5.4 6 13s-3.4 13-6 13-6-5.4-6-13 3.4-13 6-13Zm-13 11a13 13 0 0 1 3-7c-.4 2.2-.7 4.6-.7 7Zm0 4h2.3c0 2.4.3 4.8.7 7a13 13 0 0 1-3-7Zm23-11a13 13 0 0 1 3 7h-2.3c0-2.4-.3-4.8-.7-7Zm3 11a13 13 0 0 1-3 7c.4-2.2.7-4.6.7-7ZM2 18h60v4H2Z",
  corvus:
    "M4 24 26 8l10 2 8-6 2 6 14 2-12 5-6 10-10 8-2-8-10 2 4-6Zm40-13.4-3 2.2 3 1.2 2.2-2.6Z",
  halden: "M12 3h10v12h20V3h10v34H42V23H22v14H12Z",
  sylvan:
    "M32 2c12 6 18 15 16 25-1.700 7-8 11-14 11v-9l8-7-3-3-5 4v-8l-3-3-3 3v8l-5-4-3 3 8 7v9c-6 0-12.300-4-14-11C14 17 20 8 32 2Z",
  azura:
    "M3 28c7-10 13-10 20-3s12 7 18 1 11-7 20 0v7c-9-7-14-6-20 0s-12 6-18-1-13-7-20 3ZM25 19 32 4l7 15-7-3Z",
  orion:
    "m14 4 2.700 7 7.300.5-5.600 4.700 1.800 7.200L14 19.500l-6.200 3.900 1.800-7.200L4 11.500l7.300-.5Zm18 8 2.700 7 7.300.5-5.600 4.700 1.800 7.200L32 27.500l-6.200 3.900 1.800-7.200-5.600-4.700 7.300-.5Zm18 8 2.700 7 7.300.5-5.600 4.700 1.800 7.200L50 35.500Z",
  strato: "M8 8h48l-5 6H3Zm9 9h46l-5 6H12Zm-8 9h46l-5 6H4Z",
  novara:
    "M32 1l5.500 13.500L51 9l-5.500 13.500L60 20 47 27l6 12-13.500-5L32 39l-7.500-5L11 39l6-12L4 20l14.500 2.500L13 9l13.500 5.500Z",
  krona: "M6 34 2 10l13 9L24 4l8 14 8-14 9 15 13-9-4 24Zm4-8h44v-2H10Z",
  ardent:
    "M32 1c2 8 14 13 14 24 0 8-6 14-14 14s-14-6-14-14c0-6 4-9 6-14 1 3 2 5 4 6 1-6 1-11 4-16Zm0 20c-1 3-5 5-5 9 0 3 2 5 5 5s5-2 5-5c0-4-4-6-5-9Z",
};

const svgNamespace = "http://www.w3.org/2000/svg";

export function teamLogo(team: string, colour: string): SVGSVGElement {
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.setAttribute("viewBox", "0 0 64 40");
  svg.setAttribute("class", "team-logo");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svgNamespace, "path");
  path.setAttribute("d", marks[team] ?? "");
  path.setAttribute("fill", colour);
  path.setAttribute("fill-rule", "evenodd");
  svg.append(path);
  return svg;
}
