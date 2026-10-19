interface TyreReading {
  temperature: number;
  wear: number;
}

export interface Frame {
  speed: number | null;
  gear: number | null;
  rpm: number | null;
  energy: { charge: number; deploying: boolean; harvesting: boolean } | null;
  tyres: TyreReading[] | null;
  delta: number | null;
  lap: { current: number; total: number } | null;
}

export const empty: Frame = {
  speed: null,
  gear: null,
  rpm: null,
  energy: null,
  tyres: null,
  delta: null,
  lap: null,
};

export const racing: Frame = {
  speed: 86.94,
  gear: 7,
  rpm: 11_249.6,
  energy: { charge: 0.634, deploying: true, harvesting: false },
  tyres: [
    { temperature: 79.4, wear: 0.031 },
    { temperature: 95.5, wear: 0.0449 },
    { temperature: 110.4, wear: 0.12 },
    { temperature: 110.6, wear: 1 },
  ],
  delta: -0.4567,
  lap: { current: 3, total: 57 },
};

export const racingText = {
  speed: "313",
  gear: "7",
  rpm: "11250",
  energy: "63%",
  tyres: [
    { temperature: "79°C", wear: "3%", state: "cold" },
    { temperature: "96°C", wear: "4%", state: "optimal" },
    { temperature: "110°C", wear: "12%", state: "optimal" },
    { temperature: "111°C", wear: "100%", state: "hot" },
  ],
  delta: "-0.457",
  deltaTrend: "faster",
  lap: "3/57",
};

const placeholder = "—";

export const emptyText: typeof racingText = {
  speed: placeholder,
  gear: placeholder,
  rpm: placeholder,
  energy: placeholder,
  tyres: Array.from({ length: 4 }, () => ({
    temperature: placeholder,
    wear: placeholder,
    state: "unknown",
  })),
  delta: placeholder,
  deltaTrend: "unknown",
  lap: placeholder,
};
