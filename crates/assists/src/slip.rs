use crate::AssistError;
use crate::error::{finite, positive};
use serde::{Deserialize, Serialize};

pub const MIN_SLIP_SPEED: f64 = 1.0;
const CUT_GAIN: f64 = 400.0;
const RECOVER_RATE: f64 = 4.0;
const PROPORTIONAL_GAIN: f64 = 4.0;

pub fn slip_ratio(
    wheel_speed: f64,
    wheel_radius: f64,
    vehicle_speed: f64,
) -> Result<f64, AssistError> {
    finite(wheel_speed, AssistError::WheelSpeed)?;
    positive(wheel_radius, AssistError::WheelRadius)?;
    finite(vehicle_speed, AssistError::VehicleSpeed)?;
    Ok(
        ((wheel_speed * wheel_radius - vehicle_speed) / vehicle_speed.abs().max(MIN_SLIP_SPEED))
            .max(-1.0),
    )
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct SlipLimiter {
    fraction: f64,
}

impl SlipLimiter {
    pub(crate) fn new() -> Self {
        Self { fraction: 1.0 }
    }

    pub(crate) fn update(&mut self, excess: f64, dt: f64) -> f64 {
        if excess > 0.0 {
            self.fraction -= CUT_GAIN * excess * dt;
        } else {
            self.fraction += RECOVER_RATE * dt;
        }
        self.fraction = self.fraction.clamp(0.0, 1.0);
        (self.fraction - PROPORTIONAL_GAIN * excess.max(0.0)).clamp(0.0, 1.0)
    }
}
