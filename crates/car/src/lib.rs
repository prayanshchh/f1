mod aero;
mod vector;
mod wheel;

use ::aero::{ActiveAero, AeroMode};
pub use chassis::Ground;
use chassis::{Chassis, DropStart, External};
use contracts::{Input, Quat, Vec3};
use powertrain::{Powertrain, PowertrainInput, PowertrainOutput};
use serde::{Deserialize, Serialize};
use vector::*;

pub const DT: f64 = chassis::DT;
pub const WHEEL_RADIUS: f64 = powertrain::WHEEL_RADIUS;
pub const MAX_STEER_ANGLE: f64 = 0.35;
pub const REST_HEIGHT: f64 = chassis::SPRING_LENGTH - chassis::STATIC_COMPRESSION;
const START_ENERGY: f64 = 4.0e6;
const REST_SPEED: f64 = 0.05;
const REST_SPIN: f64 = 0.05;
const STRAIGHT_STEER_LIMIT: f64 = 0.05;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct WheelReport {
    pub spin: f64,
    pub slip_ratio: f64,
    pub slip_angle: f64,
    pub load: f64,
}

#[derive(Clone, Debug)]
pub struct CarReport {
    pub position: Vec3,
    pub orientation: Quat,
    pub velocity: Vec3,
    pub angular_velocity: Vec3,
    pub gear: u8,
    pub engine_rpm: f64,
    pub battery_energy: f64,
    pub ers_power: f64,
    pub straight_mode: f64,
    pub steer_angle: f64,
    pub wheels: [WheelReport; 4],
}

#[derive(Clone, Serialize, Deserialize)]
struct Outputs {
    gear: u8,
    engine_rpm: f64,
    battery_energy: f64,
    ers_power: f64,
    wheels: [WheelReport; 4],
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Car {
    chassis: Chassis,
    powertrain: Powertrain,
    active_aero: ActiveAero,
    spins: [f64; 4],
    steer_angle: f64,
    resting: bool,
    last: Outputs,
}

impl Outputs {
    fn new(out: PowertrainOutput, wheels: [WheelReport; 4]) -> Self {
        Self {
            gear: out.gear,
            engine_rpm: out.engine_rpm,
            battery_energy: out.battery_energy,
            ers_power: out.ers_power,
            wheels,
        }
    }
}

fn validate_ground(ground: &[Ground; 4]) -> Result<(), String> {
    for g in ground {
        let [x, y, z] = g.normal;
        if !g.height.is_finite()
            || ![x, y, z].iter().all(|v| v.is_finite())
            || y <= 0.0
            || (libm::sqrt(x * x + y * y + z * z) - 1.0).abs() > 1e-9
        {
            return Err("ground must be finite with an upward unit normal".into());
        }
    }
    Ok(())
}

impl Car {
    pub fn new(position: Vec3, orientation: Quat, ground: &[Ground; 4]) -> Result<Self, String> {
        validate_ground(ground)?;
        let lowest_anchor = anchors()
            .iter()
            .map(|a| position.y + rotate(&orientation, a).y)
            .fold(position.y, f64::min);
        let height = ground
            .iter()
            .map(|g| g.height)
            .fold(f64::INFINITY, f64::min);
        let ground_height = height.min(lowest_anchor - chassis::SPRING_LENGTH);
        let chassis = Chassis::new(DropStart {
            position,
            orientation,
            velocity: zero(),
            angular_velocity: zero(),
            ground_height,
        })?;
        let wheels = chassis.corners_on(ground).map(|c| WheelReport {
            spin: 0.0,
            slip_ratio: 0.0,
            slip_angle: 0.0,
            load: c.load,
        });
        Ok(Self {
            chassis,
            powertrain: Powertrain::new_2026(START_ENERGY).map_err(|e| e.to_string())?,
            active_aero: ActiveAero::new(),
            spins: [0.0; 4],
            steer_angle: 0.0,
            resting: true,
            last: Outputs {
                gear: 1,
                engine_rpm: 4000.0,
                battery_energy: START_ENERGY,
                ers_power: 0.0,
                wheels,
            },
        })
    }

    pub fn wheel_points(&self) -> [Vec3; 4] {
        let s = self.chassis.state();
        anchors().map(|a| add(&s.position, &rotate(&s.orientation, &a)))
    }

    pub fn report(&self) -> CarReport {
        let s = self.chassis.state();
        let wheels = self.last.wheels.map(|w| {
            if self.resting {
                WheelReport {
                    spin: 0.0,
                    slip_ratio: 0.0,
                    slip_angle: 0.0,
                    ..w
                }
            } else {
                w
            }
        });
        CarReport {
            position: s.position,
            orientation: s.orientation,
            velocity: if self.resting { zero() } else { s.velocity },
            angular_velocity: if self.resting {
                zero()
            } else {
                s.angular_velocity
            },
            gear: self.last.gear,
            engine_rpm: self.last.engine_rpm,
            battery_energy: self.last.battery_energy,
            ers_power: self.last.ers_power,
            straight_mode: self.active_aero.straight_mode(),
            steer_angle: self.steer_angle,
            wheels,
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        self.chassis.validate()?;
        if !self.spins.iter().all(|v| v.is_finite())
            || !(-MAX_STEER_ANGLE..=MAX_STEER_ANGLE).contains(&self.steer_angle)
            || !(0.0..=1.0).contains(&self.active_aero.straight_mode())
            || !(0.0..=START_ENERGY).contains(&self.last.battery_energy)
            || !(1..=8).contains(&self.last.gear)
            || !self.last.engine_rpm.is_finite()
            || !self.last.ers_power.is_finite()
            || !self.last.wheels.iter().all(|w| {
                [w.spin, w.slip_ratio, w.slip_angle, w.load]
                    .iter()
                    .all(|v| v.is_finite())
            })
        {
            return Err("invalid car state".into());
        }
        Ok(())
    }

    pub fn step(&mut self, input: &Input, ground: &[Ground; 4]) -> Result<(), String> {
        if !(-1.0..=1.0).contains(&input.steer)
            || !(0.0..=1.0).contains(&input.throttle)
            || !(0.0..=1.0).contains(&input.brake)
        {
            return Err("provide a valid car input".into());
        }
        validate_ground(ground)?;
        let mut next = self.clone();
        next.advance(input, ground)?;
        next.validate()?;
        *self = next;
        Ok(())
    }

    fn controls(&mut self, input: &Input) -> Result<(), String> {
        self.steer_angle = input.steer * MAX_STEER_ANGLE;
        self.active_aero.request(
            if input.throttle == 1.0
                && input.brake == 0.0
                && input.steer.abs() <= STRAIGHT_STEER_LIMIT
            {
                AeroMode::Straight
            } else {
                AeroMode::Corner
            },
        );
        self.active_aero
            .step(DT * if input.brake > 0.0 { 4.0 } else { 1.0 })
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn advance(&mut self, input: &Input, ground: &[Ground; 4]) -> Result<(), String> {
        self.controls(input)?;
        let state = self.chassis.state();
        let forward = rotate(
            &state.orientation,
            &Vec3 {
                x: 0.0,
                y: 0.0,
                z: 1.0,
            },
        );
        let out = self
            .powertrain
            .step(
                &PowertrainInput {
                    throttle: input.throttle,
                    brake: input.brake,
                    shift_up: input.shift_up,
                    shift_down: input.shift_down,
                    left_wheel_speed: self.spins[2],
                    right_wheel_speed: self.spins[3],
                    car_speed: dot(&state.velocity, &forward).max(0.0),
                },
                DT,
            )
            .map_err(|e| e.to_string())?;
        let corners = self.chassis.corners_on(ground);
        if self.resting && input.throttle == 0.0 {
            self.spins = [0.0; 4];
            self.last = Outputs::new(
                out,
                corners.map(|c| WheelReport {
                    spin: 0.0,
                    slip_ratio: 0.0,
                    slip_angle: 0.0,
                    load: c.load,
                }),
            );
            return Ok(());
        }
        self.resting = false;
        let mut forces = std::array::from_fn(|_| zero());
        let mut wheels = self.last.wheels;
        for (i, anchor) in anchors().iter().enumerate() {
            let angle = if i < 2 { self.steer_angle } else { 0.0 };
            let heading = rotate(
                &state.orientation,
                &Vec3 {
                    x: libm::sin(angle),
                    y: 0.0,
                    z: libm::cos(angle),
                },
            );
            let velocity = add(
                &state.velocity,
                &cross(&state.angular_velocity, &rotate(&state.orientation, anchor)),
            );
            let (force, report) = wheel::step(wheel::WheelInput {
                heading,
                velocity,
                ground: ground[i],
                load: corners[i].load,
                spin: self.spins[i],
                drive: if i < 2 { 0.0 } else { out.drive_torque[i - 2] },
                brake: out.brake_torque[i],
                inertia: if i < 2 { 1.2 } else { 1.6 },
            })?;
            forces[i] = force;
            wheels[i] = report;
            self.spins[i] = report.spin;
        }
        let (body_force, body_torque) = aero::forces(
            &state.orientation,
            &state.velocity,
            &corners,
            self.active_aero.straight_mode(),
        )?;
        self.chassis.step_with(&External {
            ground: *ground,
            tyre_forces: forces,
            body_force,
            body_torque,
        })?;
        let state = self.chassis.state();
        if input.throttle == 0.0
            && length(&state.velocity) < REST_SPEED
            && length(&state.angular_velocity) < REST_SPIN
            && self
                .spins
                .iter()
                .all(|s| (s * WHEEL_RADIUS).abs() < REST_SPEED)
        {
            self.resting = true;
            self.spins = [0.0; 4];
        }
        self.last = Outputs::new(out, wheels);
        Ok(())
    }
}

impl PartialEq for CarReport {
    fn eq(&self, other: &Self) -> bool {
        let components = |r: &Self| {
            [
                r.position.x,
                r.position.y,
                r.position.z,
                r.orientation.x,
                r.orientation.y,
                r.orientation.z,
                r.orientation.w,
                r.velocity.x,
                r.velocity.y,
                r.velocity.z,
                r.angular_velocity.x,
                r.angular_velocity.y,
                r.angular_velocity.z,
                r.engine_rpm,
                r.battery_energy,
                r.ers_power,
                r.straight_mode,
                r.steer_angle,
            ]
        };
        self.gear == other.gear
            && self.wheels == other.wheels
            && components(self) == components(other)
    }
}
