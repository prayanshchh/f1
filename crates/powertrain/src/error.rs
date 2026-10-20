use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum PowertrainError {
    EngineSpeed,
    Throttle,
    Brake,
    BrakeBias,
    Locking,
    Torque,
    WheelSpeed,
    CarSpeed,
    Power,
    Energy,
    TimeStep,
}

impl fmt::Display for PowertrainError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::EngineSpeed => "engine speed must be finite and not negative",
            Self::Throttle => "throttle must be between 0 and 1",
            Self::Brake => "brake pedal must be between 0 and 1",
            Self::BrakeBias => "brake bias must be between 0.45 and 0.75",
            Self::Locking => "differential locking must be between 0 and 1",
            Self::Torque => "torque must be finite",
            Self::WheelSpeed => "wheel speeds must be finite",
            Self::CarSpeed => "car speed must be finite and not negative",
            Self::Power => "motor power request must be finite",
            Self::Energy => "battery energy must be between 0 and the capacity",
            Self::TimeStep => "time step must be finite and positive",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for PowertrainError {}

pub(crate) fn unit(value: f64, error: PowertrainError) -> Result<f64, PowertrainError> {
    if (0.0..=1.0).contains(&value) {
        Ok(value)
    } else {
        Err(error)
    }
}

pub(crate) fn finite(value: f64, error: PowertrainError) -> Result<f64, PowertrainError> {
    if value.is_finite() {
        Ok(value)
    } else {
        Err(error)
    }
}

pub(crate) fn non_negative(value: f64, error: PowertrainError) -> Result<f64, PowertrainError> {
    if value.is_finite() && value >= 0.0 {
        Ok(value)
    } else {
        Err(error)
    }
}

pub(crate) fn time_step(dt: f64) -> Result<f64, PowertrainError> {
    if dt.is_finite() && dt > 0.0 {
        Ok(dt)
    } else {
        Err(PowertrainError::TimeStep)
    }
}
