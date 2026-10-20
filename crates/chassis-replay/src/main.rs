use base64::{Engine, engine::general_purpose::STANDARD};
use chassis::{Chassis, ChassisState, DropStart};
use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};
use std::process::ExitCode;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    start: DropStart,
    ticks: u32,
}

#[derive(Serialize)]
struct Response {
    hashes: Vec<String>,
    state: ChassisState,
    save: String,
}

fn respond(text: &str) -> Result<Vec<u8>, String> {
    let request: Request = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let mut chassis = Chassis::new(request.start)?;
    let mut hashes = vec![chassis.state_hash()?];
    for _ in 0..request.ticks {
        chassis.step()?;
        hashes.push(chassis.state_hash()?);
    }
    let response = Response {
        hashes,
        state: chassis.state(),
        save: STANDARD.encode(chassis.save()?),
    };
    serde_json::to_vec(&response).map_err(|e| e.to_string())
}

fn main() -> ExitCode {
    let mut text = String::new();
    let outcome = io::stdin()
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())
        .and_then(|_| respond(&text))
        .and_then(|bytes| io::stdout().write_all(&bytes).map_err(|e| e.to_string()));
    match outcome {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            let _ = writeln!(io::stderr(), "chassis-replay: {message}");
            ExitCode::FAILURE
        }
    }
}
