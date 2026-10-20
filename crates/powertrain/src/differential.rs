use crate::error::{PowertrainError, finite, unit};
use serde::{Deserialize, Serialize};

const SLIP_SCALE: f64 = 1.0;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Differential {
    locking: f64,
}

impl Differential {
    pub fn new(locking: f64) -> Result<Self, PowertrainError> {
        Ok(Self {
            locking: unit(locking, PowertrainError::Locking)?,
        })
    }

    pub fn split(&self, input: f64, left: f64, right: f64) -> Result<(f64, f64), PowertrainError> {
        let input = finite(input, PowertrainError::Torque)?;
        let left = finite(left, PowertrainError::WheelSpeed)?;
        let right = finite(right, PowertrainError::WheelSpeed)?;
        let slip = left - right;
        let transfer = self.locking * libm::fabs(input) * slip / (libm::fabs(slip) + SLIP_SCALE);
        let left_torque = input * 0.5 - transfer * 0.5;
        Ok((left_torque, input - left_torque))
    }
}
