use base64::{Engine, engine::general_purpose::STANDARD};
use contracts::{Input, Snapshot, WorldSetup};
use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    setup: WorldSetup,
    inputs: Vec<Vec<Input>>,
}

#[derive(Serialize)]
struct Response {
    hashes: Vec<String>,
    snapshot: Snapshot,
    save: String,
}

fn replay() -> Result<Vec<u8>, String> {
    let mut text = String::new();
    io::stdin()
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    let request: Request = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let mut world = physics::World::new(request.setup)?;
    let mut hashes = vec![world.state_hash()?];
    for inputs in request.inputs {
        world.step(&inputs)?;
        hashes.push(world.state_hash()?);
    }
    let response = Response {
        hashes,
        snapshot: world.snapshot(),
        save: STANDARD.encode(world.save()?),
    };
    serde_json::to_vec(&response).map_err(|e| e.to_string())
}

fn main() -> std::process::ExitCode {
    match replay().and_then(|bytes| {
        io::stdout()
            .lock()
            .write_all(&bytes)
            .map_err(|e| e.to_string())
    }) {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(message) => {
            let _ = writeln!(io::stderr().lock(), "{message}");
            std::process::ExitCode::FAILURE
        }
    }
}
