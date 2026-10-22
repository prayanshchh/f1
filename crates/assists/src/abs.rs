use crate::error::{finite, positive};
use crate::slip::SlipLimiter;
use crate::{AssistError, AssistLevel, slip_ratio};
use serde::{Deserialize, Serialize};

pub const ABS_MIN_SPEED: f64 = 2.0;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct AbsInput {
    pub wheel_speeds: [f64; 4],
    pub vehicle_speed: f64,
    pub brake_torque: [f64; 4],
    pub wheel_radius: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct AbsOutput {
    pub brake_torque: [f64; 4],
    pub active: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Abs {
    level: AssistLevel,
    limiters: [SlipLimiter; 4],
}

impl Abs {
    #[must_use]
    pub fn new(level: AssistLevel) -> Self {
        Self {
            level,
            limiters: [SlipLimiter::new(); 4],
        }
    }

    #[must_use]
    pub fn level(&self) -> AssistLevel {
        self.level
    }

    pub fn set_level(&mut self, level: AssistLevel) {
        self.level = level;
        self.limiters = [SlipLimiter::new(); 4];
    }

    pub fn step(&mut self, input: &AbsInput, dt: f64) -> Result<AbsOutput, AssistError> {
        positive(dt, AssistError::TimeStep)?;
        let mut slips = [0.0; 4];
        for (slip, speed) in slips.iter_mut().zip(input.wheel_speeds) {
            *slip = slip_ratio(speed, input.wheel_radius, input.vehicle_speed)?;
        }
        for torque in input.brake_torque {
            finite(torque, AssistError::Torque)?;
            if torque < 0.0 {
                return Err(AssistError::Torque);
            }
        }
        let mut output = AbsOutput {
            brake_torque: input.brake_torque,
            active: false,
        };
        let Some(target) = self.level.target_slip() else {
            return Ok(output);
        };
        if input.vehicle_speed.abs() < ABS_MIN_SPEED {
            self.limiters = [SlipLimiter::new(); 4];
            return Ok(output);
        }
        for ((limiter, slip), torque) in self
            .limiters
            .iter_mut()
            .zip(slips)
            .zip(&mut output.brake_torque)
        {
            let fraction = limiter.update(-slip - target, dt);
            output.active |= *torque > 0.0 && fraction < 1.0;
            *torque *= fraction;
        }
        Ok(output)
    }
}
