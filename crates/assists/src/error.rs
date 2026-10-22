use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum AssistError {
    Steer,
    Throttle,
    Brake,
    TimeStep,
    Rate,
    TimeConstant,
    WheelSpeed,
    VehicleSpeed,
    WheelRadius,
    Torque,
}

impl fmt::Display for AssistError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Steer => "steer command must be between -1 and 1",
            Self::Throttle => "throttle must be between 0 and 1",
            Self::Brake => "brake pedal must be between 0 and 1",
            Self::TimeStep => "time step must be finite and positive",
            Self::Rate => "rack rate must be finite and positive",
            Self::TimeConstant => "pedal time constant must be finite and positive",
            Self::WheelSpeed => "wheel speeds must be finite",
            Self::VehicleSpeed => "vehicle speed must be finite",
            Self::WheelRadius => "wheel radius must be finite and positive",
            Self::Torque => "torques must be finite and brake torques not negative",
        })
    }
}

impl std::error::Error for AssistError {}

pub(crate) fn range(
    value: f64,
    low: f64,
    high: f64,
    error: AssistError,
) -> Result<f64, AssistError> {
    if (low..=high).contains(&value) {
        Ok(value)
    } else {
        Err(error)
    }
}

pub(crate) fn positive(value: f64, error: AssistError) -> Result<f64, AssistError> {
    if value.is_finite() && value > 0.0 {
        Ok(value)
    } else {
        Err(error)
    }
}

pub(crate) fn finite(value: f64, error: AssistError) -> Result<f64, AssistError> {
    if value.is_finite() {
        Ok(value)
    } else {
        Err(error)
    }
}
