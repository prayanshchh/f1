import teamData from "../../../../content/cars/teams.json";

const files = import.meta.glob<string>(
  "../../../../content/cars/*/*.{glb,jpg}",
  { eager: true, query: "?url", import: "default" },
);

interface TeamDriver {
  first: string;
  last: string;
  nationality: string;
  number: number;
}

export interface TeamRatings {
  performance: number;
  aero: number;
  power: number;
  reliability: number;
}

export interface Team {
  id: string;
  name: string;
  fullName: string;
  brand: string;
  principal: string;
  chassis: string;
  base: string;
  powerUnit: string;
  ratings: TeamRatings;
  drivers: TeamDriver[];
  sponsors: string[];
}

export const teams: Team[] = teamData;

export function teamOf(id: string): Team {
  const team = teams.find((candidate) => candidate.id === id) ?? teams[0];
  if (!team) throw new Error("no teams defined");
  return team;
}

export interface GridEntry {
  position: number;
  team: Team;
  first: string;
  last: string;
  number: number;
  nationality: string;
  player: boolean;
}

export interface PlayerSeat {
  team: string;
  first: string;
  last: string;
  number: number;
  nationality: string;
}

const carsPerTeam = 2;

export function gridTeamOrder(player: string): string[] {
  return [
    player,
    ...teams.map((team) => team.id).filter((id) => id !== player),
  ].flatMap((id) => Array.from({ length: carsPerTeam }, () => id));
}

export function startingGrid(player: PlayerSeat, slot = 0): GridEntry[] {
  const seats = new Map<string, number>();
  const others = gridTeamOrder(player.team)
    .slice(1)
    .map((id): Omit<GridEntry, "position"> => {
      const team = teamOf(id);
      const seat = seats.get(id) ?? 0;
      seats.set(id, seat + 1);
      const driver = team.drivers[seat];
      if (!driver) throw new Error(`team ${id} is short of drivers`);
      return { ...driver, team, player: false };
    });
  others.splice(slot, 0, {
    first: player.first,
    last: player.last,
    number: player.number,
    nationality: player.nationality,
    team: teamOf(player.team),
    player: true,
  });
  return others.map((entry, index) => ({ ...entry, position: index + 1 }));
}

export interface FieldSeat {
  car: string;
  seat: number;
  player: boolean;
}

export function seatDriver(
  player: PlayerSeat,
  entrant: FieldSeat,
): Omit<GridEntry, "position"> {
  const team = teamOf(entrant.car);
  if (entrant.player) return { ...player, team, player: true };
  const driver = team.drivers[entrant.seat];
  if (!driver) throw new Error(`team ${team.id} is short of drivers`);
  return { ...driver, team, player: false };
}

export function gridOrder(slots: number[]): number[] {
  return slots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => a.slot - b.slot)
    .map(({ index }) => index);
}

export function fieldGrid(
  player: PlayerSeat,
  entrants: FieldSeat[],
  slots: number[],
): GridEntry[] {
  return gridOrder(slots).flatMap((index, place) => {
    const entrant = entrants[index];
    return entrant
      ? [{ ...seatDriver(player, entrant), position: place + 1 }]
      : [];
  });
}

export function carFile(team: string, name: string): string {
  const url = files[`../../../../content/cars/${team}/${name}`];
  if (!url) throw new Error(`missing car file ${team}/${name}`);
  return url;
}
