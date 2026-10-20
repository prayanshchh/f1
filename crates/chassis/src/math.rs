use contracts::{Quat, Vec3};
use serde::{Deserialize, Serialize};
use std::ops::{Add, Mul, Sub};

#[derive(Clone, Copy, Serialize, Deserialize)]
pub struct V3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl V3 {
    pub const ZERO: Self = Self::new(0.0, 0.0, 0.0);

    pub const fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }

    pub fn cross(self, other: Self) -> Self {
        Self::new(
            self.y * other.z - self.z * other.y,
            self.z * other.x - self.x * other.z,
            self.x * other.y - self.y * other.x,
        )
    }

    pub fn scaled(self, other: Self) -> Self {
        Self::new(self.x * other.x, self.y * other.y, self.z * other.z)
    }

    pub fn divided(self, other: Self) -> Self {
        Self::new(self.x / other.x, self.y / other.y, self.z / other.z)
    }

    pub fn length(self) -> f64 {
        libm::sqrt(self.x * self.x + self.y * self.y + self.z * self.z)
    }

    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite()
    }
}

impl Add for V3 {
    type Output = Self;

    fn add(self, other: Self) -> Self {
        Self::new(self.x + other.x, self.y + other.y, self.z + other.z)
    }
}

impl Sub for V3 {
    type Output = Self;

    fn sub(self, other: Self) -> Self {
        Self::new(self.x - other.x, self.y - other.y, self.z - other.z)
    }
}

impl Mul<f64> for V3 {
    type Output = Self;

    fn mul(self, factor: f64) -> Self {
        Self::new(self.x * factor, self.y * factor, self.z * factor)
    }
}

impl From<&Vec3> for V3 {
    fn from(v: &Vec3) -> Self {
        Self::new(v.x, v.y, v.z)
    }
}

impl From<V3> for Vec3 {
    fn from(v: V3) -> Self {
        Self {
            x: v.x,
            y: v.y,
            z: v.z,
        }
    }
}

#[derive(Clone, Copy, Serialize, Deserialize)]
pub struct Rotation {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub w: f64,
}

impl Rotation {
    fn axis(self) -> V3 {
        V3::new(self.x, self.y, self.z)
    }

    fn conjugate(self) -> Self {
        Self {
            x: -self.x,
            y: -self.y,
            z: -self.z,
            w: self.w,
        }
    }

    pub fn norm(self) -> f64 {
        libm::sqrt(self.x * self.x + self.y * self.y + self.z * self.z + self.w * self.w)
    }

    pub fn is_finite(self) -> bool {
        self.axis().is_finite() && self.w.is_finite()
    }

    pub fn rotate(self, v: V3) -> V3 {
        let t = self.axis().cross(v) * 2.0;
        v + t * self.w + self.axis().cross(t)
    }

    pub fn unrotate(self, v: V3) -> V3 {
        self.conjugate().rotate(v)
    }

    fn then(self, other: Self) -> Self {
        Self {
            x: other.w * self.x + other.x * self.w + other.y * self.z - other.z * self.y,
            y: other.w * self.y - other.x * self.z + other.y * self.w + other.z * self.x,
            z: other.w * self.z + other.x * self.y - other.y * self.x + other.z * self.w,
            w: other.w * self.w - other.x * self.x - other.y * self.y - other.z * self.z,
        }
    }

    pub fn turned(self, spin: V3, time: f64) -> Self {
        let rate = spin.length();
        if rate == 0.0 {
            return self;
        }
        let half = rate * time * 0.5;
        let axis = spin * (libm::sin(half) / rate);
        let turned = self.then(Self {
            x: axis.x,
            y: axis.y,
            z: axis.z,
            w: libm::cos(half),
        });
        let norm = turned.norm();
        Self {
            x: turned.x / norm,
            y: turned.y / norm,
            z: turned.z / norm,
            w: turned.w / norm,
        }
    }
}

impl From<&Quat> for Rotation {
    fn from(q: &Quat) -> Self {
        Self {
            x: q.x,
            y: q.y,
            z: q.z,
            w: q.w,
        }
    }
}

impl From<Rotation> for Quat {
    fn from(q: Rotation) -> Self {
        Self {
            x: q.x,
            y: q.y,
            z: q.z,
            w: q.w,
        }
    }
}
