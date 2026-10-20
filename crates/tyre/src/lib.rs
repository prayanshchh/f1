use core::f64::consts::FRAC_PI_2;
use core::fmt;
use serde::{Deserialize, Serialize};

pub fn magic_formula(x: f64, b: f64, c: f64, d: f64, e: f64) -> f64 {
    if x < 0.0 {
        return -magic_formula(-x, b, c, d, e);
    }
    let bx = b * x;
    d * libm::sin(c * libm::atan(bx - e * (bx - libm::atan(bx))))
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Curve {
    pub stiffness: f64,
    pub shape: f64,
    pub friction: f64,
    pub curvature: f64,
}

impl Curve {
    fn force(&self, combined_slip: f64, scale: f64) -> f64 {
        magic_formula(
            combined_slip,
            1.0,
            self.shape,
            self.friction * scale,
            self.curvature,
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Tyre {
    pub nominal_load: f64,
    pub load_sensitivity: f64,
    pub longitudinal: Curve,
    pub lateral: Curve,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct TyreForces {
    pub longitudinal: f64,
    pub lateral: f64,
}

impl TyreForces {
    const NONE: Self = Self {
        longitudinal: 0.0,
        lateral: 0.0,
    };
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TyreError {
    NonFinite,
    SlipRatioBelowLockup,
    SlipAngleOutOfRange,
}

impl fmt::Display for TyreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::NonFinite => "tyre inputs must be finite",
            Self::SlipRatioBelowLockup => "slip ratio must not be below -1",
            Self::SlipAngleOutOfRange => "slip angle must be within ±π/2",
        })
    }
}

impl std::error::Error for TyreError {}

impl Tyre {
    pub const fn slick() -> Self {
        Self {
            nominal_load: 4000.0,
            load_sensitivity: 0.1,
            longitudinal: Curve {
                stiffness: 12.0,
                shape: 1.55,
                friction: 1.75,
                curvature: 0.2,
            },
            lateral: Curve {
                stiffness: 18.0,
                shape: 1.4,
                friction: 1.7,
                curvature: 0.0,
            },
        }
    }

    pub const fn nominal_load(&self) -> f64 {
        self.nominal_load
    }

    pub fn forces(
        &self,
        load: f64,
        slip_ratio: f64,
        slip_angle: f64,
    ) -> Result<TyreForces, TyreError> {
        if !(load.is_finite() && slip_ratio.is_finite() && slip_angle.is_finite()) {
            return Err(TyreError::NonFinite);
        }
        if slip_ratio < -1.0 {
            return Err(TyreError::SlipRatioBelowLockup);
        }
        if slip_angle.abs() > FRAC_PI_2 {
            return Err(TyreError::SlipAngleOutOfRange);
        }
        if load <= 0.0 {
            return Ok(TyreForces::NONE);
        }
        let x = self.longitudinal.stiffness * slip_ratio;
        let y = self.lateral.stiffness * slip_angle;
        let combined = libm::hypot(x, y);
        if combined == 0.0 {
            return Ok(TyreForces::NONE);
        }
        let scale = self.load_scale(load);
        Ok(TyreForces {
            longitudinal: x / combined * self.longitudinal.force(combined, scale),
            lateral: -(y / combined) * self.lateral.force(combined, scale),
        })
    }

    fn load_scale(&self, load: f64) -> f64 {
        let sensitivity = self.load_sensitivity;
        load * (1.0 + sensitivity) / (1.0 + sensitivity * load / self.nominal_load)
    }
}
