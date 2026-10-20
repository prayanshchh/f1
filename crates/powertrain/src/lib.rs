mod brakes;
mod differential;
mod engine;
mod error;
mod ers;
mod gearbox;

pub use brakes::{Brakes, MAX_BRAKE_BIAS, MIN_BRAKE_BIAS};
pub use differential::Differential;
pub use engine::Engine;
pub use error::PowertrainError;
pub use ers::Ers;
pub use gearbox::Gearbox;

use error::{finite, non_negative, time_step, unit};
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

pub const WHEEL_RADIUS: f64 = 0.36;

const RPM_TO_RAD: f64 = 2.0 * PI / 60.0;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct PowertrainInput {
    pub throttle: f64,
    pub brake: f64,
    pub shift_up: bool,
    pub shift_down: bool,
    pub left_wheel_speed: f64,
    pub right_wheel_speed: f64,
    pub car_speed: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct PowertrainOutput {
    pub gear: u8,
    pub engine_rpm: f64,
    pub drive_torque: [f64; 2],
    pub brake_torque: [f64; 4],
    pub ers_power: f64,
    pub battery_energy: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Powertrain {
    engine: Engine,
    gearbox: Gearbox,
    differential: Differential,
    brakes: Brakes,
    ers: Ers,
    brake_bias: f64,
    gear: u8,
    shift_up_held: bool,
    shift_down_held: bool,
}

impl Powertrain {
    pub fn new_2026(energy: f64) -> Result<Self, PowertrainError> {
        Ok(Self {
            engine: Engine::v6_2026(),
            gearbox: Gearbox::eight_speed(),
            differential: Differential::new(0.3)?,
            brakes: Brakes::car_2026(),
            ers: Ers::new_2026(energy)?,
            brake_bias: 0.56,
            gear: 1,
            shift_up_held: false,
            shift_down_held: false,
        })
    }

    #[must_use]
    pub fn gear(&self) -> u8 {
        self.gear
    }

    #[must_use]
    pub fn brake_bias(&self) -> f64 {
        self.brake_bias
    }

    #[must_use]
    pub fn ers(&self) -> &Ers {
        &self.ers
    }

    pub fn set_brake_bias(&mut self, bias: f64) -> Result<(), PowertrainError> {
        self.brake_bias = brakes::brake_bias(bias)?;
        Ok(())
    }

    pub fn step(
        &mut self,
        input: &PowertrainInput,
        dt: f64,
    ) -> Result<PowertrainOutput, PowertrainError> {
        let throttle = unit(input.throttle, PowertrainError::Throttle)?;
        let brake = unit(input.brake, PowertrainError::Brake)?;
        let left = finite(input.left_wheel_speed, PowertrainError::WheelSpeed)?;
        let right = finite(input.right_wheel_speed, PowertrainError::WheelSpeed)?;
        let car_speed = non_negative(input.car_speed, PowertrainError::CarSpeed)?;
        let dt = time_step(dt)?;
        let wheel = (left + right) * 0.5;
        let gear = self.next_gear(input, wheel);
        let ratio = self.ratio(gear);
        let engine_speed = (wheel * ratio).max(self.engine.idle_rpm() * RPM_TO_RAD);
        let engine_rpm = engine_speed / RPM_TO_RAD;
        let engine_torque = self.engine.torque(engine_rpm, throttle)?;
        let mut ers = self.ers;
        let target = self.brakes.torques(brake, self.brake_bias)?;
        let (ers_power, brake_torque, motor_torque) = if brake > 0.0 {
            let rear = target[2] + target[3];
            let request = if wheel > 0.0 { -rear * wheel } else { 0.0 };
            let harvested = ers.step(request, car_speed, dt)?;
            let regen = if wheel > 0.0 { -harvested / wheel } else { 0.0 };
            let friction = ((rear - regen) * 0.5).max(0.0);
            (harvested, [target[0], target[1], friction, friction], 0.0)
        } else {
            let deployed = ers.step(throttle * ers.max_power(car_speed), car_speed, dt)?;
            (deployed, target, deployed / engine_speed)
        };
        let drive = (engine_torque + motor_torque) * ratio;
        let (left_drive, right_drive) = self.differential.split(drive, left, right)?;
        self.ers = ers;
        self.gear = gear;
        self.shift_up_held = input.shift_up;
        self.shift_down_held = input.shift_down;
        Ok(PowertrainOutput {
            gear,
            engine_rpm,
            drive_torque: [left_drive, right_drive],
            brake_torque,
            ers_power,
            battery_energy: ers.energy(),
        })
    }

    fn ratio(&self, gear: u8) -> f64 {
        self.gearbox.ratios()[usize::from(gear.clamp(1, 8) - 1)]
    }

    fn next_gear(&self, input: &PowertrainInput, wheel: f64) -> u8 {
        let up = input.shift_up && !self.shift_up_held;
        let down = input.shift_down && !self.shift_down_held;
        if up && !down && self.gear < 8 {
            return self.gear + 1;
        }
        if down && !up && self.gear > 1 {
            let lower = self.gear - 1;
            if wheel * self.ratio(lower) <= self.engine.limiter_rpm() * RPM_TO_RAD {
                return lower;
            }
        }
        self.gear
    }
}
