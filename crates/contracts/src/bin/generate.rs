use contracts::{
    CarSetup, CarState, ClientMessage, Input, MAX_CARS, PHYSICS_HZ, Quat, SNAPSHOT_INTERVAL_TICKS,
    ServerMessage, Snapshot, TrackData, Vec3, WorldSetup,
};
use std::io::{self, Write};
use ts_rs::TS;

fn main() -> io::Result<()> {
    let declarations = [
        Vec3::decl(),
        Quat::decl(),
        Input::decl(),
        CarState::decl(),
        Snapshot::decl(),
        TrackData::decl(),
        CarSetup::decl(),
        WorldSetup::decl(),
        ClientMessage::decl(),
        ServerMessage::decl(),
    ];
    let mut output = io::stdout().lock();
    writeln!(
        output,
        "export const PHYSICS_HZ = {PHYSICS_HZ};\nexport const SNAPSHOT_INTERVAL_TICKS = {SNAPSHOT_INTERVAL_TICKS};\nexport const MAX_CARS = {MAX_CARS};"
    )?;
    for declaration in declarations {
        writeln!(output, "export {declaration}")?;
    }
    Ok(())
}
