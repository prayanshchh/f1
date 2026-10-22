use crate::error::{PowertrainError, non_negative, unit};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Engine {
    idle_rpm: f64,
    limiter_rpm: f64,
    cut_band_rpm: f64,
    peak_torque: f64,
    peak_torque_rpm: f64,
    torque_falloff: f64,
    friction_torque: f64,
    friction_per_rpm: f64,
}

impl Engine {
    #[must_use]
    pub fn v6_2026() -> Self {
        Self {
            idle_rpm: 4_000.0,
            limiter_rpm: 13_000.0,
            cut_band_rpm: 850.0,
            peak_torque: 345.0,
            peak_torque_rpm: 9_500.0,
            torque_falloff: 3.0e-6,
            friction_torque: 8.0,
            friction_per_rpm: 0.004,
        }
    }

    #[must_use]
    pub fn idle_rpm(&self) -> f64 {
        self.idle_rpm
    }

    #[must_use]
    pub fn limiter_rpm(&self) -> f64 {
        self.limiter_rpm
    }

    pub fn torque(&self, rpm: f64, throttle: f64) -> Result<f64, PowertrainError> {
        let rpm = non_negative(rpm, PowertrainError::EngineSpeed)?;
        let throttle = unit(throttle, PowertrainError::Throttle)?;
        let friction = -(self.friction_torque + self.friction_per_rpm * rpm);
        if rpm >= self.limiter_rpm {
            return Ok(friction);
        }
        let offset = rpm - self.peak_torque_rpm;
        let full = self.peak_torque - self.torque_falloff * offset * offset;
        let cut = ((self.limiter_rpm - rpm) / self.cut_band_rpm).min(1.0);
        Ok(friction + throttle * cut * (full - friction))
    }
}
