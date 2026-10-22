use crate::error::{finite, positive};
use crate::slip::SlipLimiter;
use crate::{AssistError, AssistLevel, slip_ratio};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct TractionInput {
    pub rear_wheel_speeds: [f64; 2],
    pub vehicle_speed: f64,
    pub drive_torque: [f64; 2],
    pub wheel_radius: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct TractionOutput {
    pub drive_torque: [f64; 2],
    pub active: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct TractionControl {
    level: AssistLevel,
    limiters: [SlipLimiter; 2],
}

impl TractionControl {
    #[must_use]
    pub fn new(level: AssistLevel) -> Self {
        Self {
            level,
            limiters: [SlipLimiter::new(); 2],
        }
    }

    #[must_use]
    pub fn level(&self) -> AssistLevel {
        self.level
    }

    pub fn set_level(&mut self, level: AssistLevel) {
        self.level = level;
        self.limiters = [SlipLimiter::new(); 2];
    }

    pub fn step(&mut self, input: &TractionInput, dt: f64) -> Result<TractionOutput, AssistError> {
        positive(dt, AssistError::TimeStep)?;
        let mut slips = [0.0; 2];
        for (slip, speed) in slips.iter_mut().zip(input.rear_wheel_speeds) {
            *slip = slip_ratio(speed, input.wheel_radius, input.vehicle_speed)?;
        }
        for torque in input.drive_torque {
            finite(torque, AssistError::Torque)?;
        }
        let mut output = TractionOutput {
            drive_torque: input.drive_torque,
            active: false,
        };
        let Some(target) = self.level.target_slip() else {
            return Ok(output);
        };
        for ((limiter, slip), torque) in self
            .limiters
            .iter_mut()
            .zip(slips)
            .zip(&mut output.drive_torque)
        {
            let fraction = limiter.update(slip - target, dt);
            if *torque > 0.0 {
                output.active |= fraction < 1.0;
                *torque *= fraction;
            }
        }
        Ok(output)
    }
}
