import teamData from "../../../../content/cars/teams.json";

const files = import.meta.glob<string>(
  "../../../../content/cars/*/*.{glb,jpg}",
  { eager: true, query: "?url", import: "default" },
);

export interface Team {
  id: string;
  name: string;
}

export const teams: Team[] = teamData;

export function carFile(team: string, name: string): string {
  const url = files[`../../../../content/cars/${team}/${name}`];
  if (!url) throw new Error(`missing car file ${team}/${name}`);
  return url;
}
