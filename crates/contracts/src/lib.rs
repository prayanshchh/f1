use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const PHYSICS_HZ: u32 = 500;
pub const SNAPSHOT_INTERVAL_TICKS: u32 = 8;
pub const MAX_CARS: usize = 22;

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Quat {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub w: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    pub steer: f64,
    pub throttle: f64,
    pub brake: f64,
    pub shift_up: bool,
    pub shift_down: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WheelState {
    pub spin: f64,
    pub slip_ratio: f64,
    pub slip_angle: f64,
    pub load: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CarState {
    pub id: u8,
    pub position: Vec3,
    pub orientation: Quat,
    pub velocity: Vec3,
    pub angular_velocity: Vec3,
    pub lap: u32,
    pub lap_distance: f64,
    pub gear: u8,
    pub engine_rpm: f64,
    pub battery_energy: f64,
    pub ers_power: f64,
    pub straight_mode: f64,
    pub steer_angle: f64,
    pub wheels: [WheelState; 4],
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub tick: u32,
    pub cars: Vec<CarState>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrackData {
    pub name: String,
    pub width: f64,
    pub centerline: Vec<Vec3>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CarSetup {
    pub id: u8,
    pub start_distance: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorldSetup {
    pub track: TrackData,
    pub cars: Vec<CarSetup>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ClientMessage {
    Join { name: String },
    Input { tick: u32, input: Input },
    Ping { client_time: f64 },
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ServerMessage {
    Welcome {
        car_id: u8,
        setup: WorldSetup,
        tick: u32,
    },
    Snapshot {
        snapshot: Snapshot,
        last_input_tick: u32,
    },
    Pong {
        client_time: f64,
        server_tick: u32,
    },
    Rejected {
        reason: String,
    },
}
