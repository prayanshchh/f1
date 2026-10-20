use crate::error::{PowertrainError, unit};
use serde::{Deserialize, Serialize};

pub const MIN_BRAKE_BIAS: f64 = 0.45;
pub const MAX_BRAKE_BIAS: f64 = 0.75;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Brakes {
    max_torque: f64,
}

pub(crate) fn brake_bias(bias: f64) -> Result<f64, PowertrainError> {
    if (MIN_BRAKE_BIAS..=MAX_BRAKE_BIAS).contains(&bias) {
        Ok(bias)
    } else {
        Err(PowertrainError::BrakeBias)
    }
}

impl Brakes {
    #[must_use]
    pub fn car_2026() -> Self {
        Self {
            max_torque: 18_000.0,
        }
    }

    pub fn torques(&self, pedal: f64, bias: f64) -> Result<[f64; 4], PowertrainError> {
        let pedal = unit(pedal, PowertrainError::Brake)?;
        let bias = brake_bias(bias)?;
        let total = self.max_torque * pedal;
        let front = total * bias * 0.5;
        let rear = total * (1.0 - bias) * 0.5;
        Ok([front, front, rear, rear])
    }
}
