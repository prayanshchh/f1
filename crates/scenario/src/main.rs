use contracts::{Input, PHYSICS_HZ, Snapshot, WorldSetup};
use physics::World;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::ExitCode;

const MAX_TICKS: u32 = 1_000_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Segment {
    from_tick: u32,
    cars: Vec<Input>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Scenario {
    name: String,
    setup: WorldSetup,
    ticks: u32,
    inputs: Vec<Segment>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Channels {
    time: Vec<f64>,
    speed: Vec<f64>,
    throttle: Vec<f64>,
    brake: Vec<f64>,
    steer: Vec<f64>,
    lap: Vec<u32>,
    lap_distance: Vec<f64>,
    x: Vec<f64>,
    y: Vec<f64>,
    z: Vec<f64>,
}

#[derive(Serialize)]
struct CarTelemetry {
    id: u8,
    channels: Channels,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Telemetry {
    name: String,
    hz: u32,
    cars: Vec<CarTelemetry>,
    final_hash: String,
}

fn validate(scenario: &Scenario) -> Result<(), String> {
    if scenario.name.trim().is_empty() {
        return Err("the scenario name must not be empty".into());
    }
    if !(1..=MAX_TICKS).contains(&scenario.ticks) {
        return Err(format!("ticks must be between 1 and {MAX_TICKS}"));
    }
    let starts: Vec<u32> = scenario.inputs.iter().map(|s| s.from_tick).collect();
    if starts.first() != Some(&0) {
        return Err("the first input segment must start at tick 0".into());
    }
    if starts.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err("input segments must start at strictly increasing ticks".into());
    }
    if starts.iter().any(|&start| start >= scenario.ticks) {
        return Err("every input segment must start before the last tick".into());
    }
    let cars = scenario.setup.cars.len();
    if scenario.inputs.iter().any(|s| s.cars.len() != cars) {
        return Err(format!("every input segment must have {cars} cars"));
    }
    Ok(())
}

fn record(cars: &mut [CarTelemetry], snapshot: &Snapshot, inputs: &[Input]) {
    let time = f64::from(snapshot.tick) / f64::from(PHYSICS_HZ);
    for ((car, state), input) in cars.iter_mut().zip(&snapshot.cars).zip(inputs) {
        let v = &state.velocity;
        let c = &mut car.channels;
        c.time.push(time);
        c.speed.push(libm::sqrt(v.x * v.x + v.y * v.y + v.z * v.z));
        c.throttle.push(input.throttle);
        c.brake.push(input.brake);
        c.steer.push(input.steer);
        c.lap.push(state.lap);
        c.lap_distance.push(state.lap_distance);
        c.x.push(state.position.x);
        c.y.push(state.position.y);
        c.z.push(state.position.z);
    }
}

fn simulate(scenario: Scenario) -> Result<Telemetry, String> {
    validate(&scenario)?;
    let mut world = World::new(scenario.setup.clone())?;
    let mut cars: Vec<CarTelemetry> = scenario
        .setup
        .cars
        .iter()
        .map(|car| CarTelemetry {
            id: car.id,
            channels: Channels::default(),
        })
        .collect();
    let mut segment = 0;
    for tick in 0..=scenario.ticks {
        let active = tick.min(scenario.ticks - 1);
        while scenario
            .inputs
            .get(segment + 1)
            .is_some_and(|next| next.from_tick <= active)
        {
            segment += 1;
        }
        let inputs = scenario
            .inputs
            .get(segment)
            .map(|s| s.cars.as_slice())
            .unwrap_or_default();
        record(&mut cars, &world.snapshot(), inputs);
        if tick < scenario.ticks {
            world.step(inputs)?;
        }
    }
    Ok(Telemetry {
        name: scenario.name,
        hz: PHYSICS_HZ,
        cars,
        final_hash: world.state_hash()?,
    })
}

fn execute(args: &[String]) -> Result<Vec<u8>, String> {
    let [command, file] = args else {
        return Err("usage: scenario run <file>".into());
    };
    if command != "run" {
        return Err(format!(
            "unknown command {command}; usage: scenario run <file>"
        ));
    }
    let text = std::fs::read_to_string(file).map_err(|e| format!("cannot read {file}: {e}"))?;
    let scenario: Scenario =
        serde_json::from_str(&text).map_err(|e| format!("invalid scenario {file}: {e}"))?;
    let telemetry = simulate(scenario)?;
    serde_json::to_vec(&telemetry).map_err(|e| e.to_string())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let outcome = execute(&args).and_then(|bytes| {
        std::io::stdout()
            .lock()
            .write_all(&bytes)
            .map_err(|e| e.to_string())
    });
    if let Err(message) = outcome {
        let _ = writeln!(std::io::stderr().lock(), "scenario: {message}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
