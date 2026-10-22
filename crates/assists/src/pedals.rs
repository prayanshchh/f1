use crate::AssistError;
use crate::error::{positive, range};
use serde::{Deserialize, Serialize};

pub const THROTTLE_TIME: f64 = 0.03;
pub const BRAKE_TIME: f64 = 0.02;
const PEDAL_SNAP: f64 = 1e-6;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct PedalPositions {
    pub throttle: f64,
    pub brake: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Pedals {
    throttle_time: f64,
    brake_time: f64,
    position: PedalPositions,
}

impl Pedals {
    pub fn new(throttle_time: f64, brake_time: f64) -> Result<Self, AssistError> {
        positive(throttle_time, AssistError::TimeConstant)?;
        positive(brake_time, AssistError::TimeConstant)?;
        Ok(Self {
            throttle_time,
            brake_time,
            position: PedalPositions {
                throttle: 0.0,
                brake: 0.0,
            },
        })
    }

    #[must_use]
    pub fn positions(&self) -> PedalPositions {
        self.position
    }

    pub fn step(
        &mut self,
        throttle: f64,
        brake: f64,
        dt: f64,
    ) -> Result<PedalPositions, AssistError> {
        range(throttle, 0.0, 1.0, AssistError::Throttle)?;
        range(brake, 0.0, 1.0, AssistError::Brake)?;
        positive(dt, AssistError::TimeStep)?;
        self.position = PedalPositions {
            throttle: lag(self.position.throttle, throttle, self.throttle_time, dt),
            brake: lag(self.position.brake, brake, self.brake_time, dt),
        };
        Ok(self.position)
    }
}

fn lag(current: f64, target: f64, time: f64, dt: f64) -> f64 {
    let alpha = 1.0 - libm::exp(-dt / time);
    let next = current + (target - current) * alpha;
    if (target - next).abs() <= PEDAL_SNAP {
        target
    } else {
        next.clamp(0.0, 1.0)
    }
}
