use crate::error::{PowertrainError, finite, non_negative, time_step};
use serde::{Deserialize, Serialize};

const KMH: f64 = 1.0 / 3.6;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Ers {
    capacity: f64,
    energy: f64,
    efficiency: f64,
    motor_power: f64,
    taper_start: f64,
    taper_end: f64,
    deployed: f64,
    harvested: f64,
}

impl Ers {
    pub fn new_2026(energy: f64) -> Result<Self, PowertrainError> {
        let capacity = 4.0e6;
        if !(0.0..=capacity).contains(&energy) {
            return Err(PowertrainError::Energy);
        }
        Ok(Self {
            capacity,
            energy,
            efficiency: 0.9,
            motor_power: 350_000.0,
            taper_start: 290.0 * KMH,
            taper_end: 355.0 * KMH,
            deployed: 0.0,
            harvested: 0.0,
        })
    }

    #[must_use]
    pub fn capacity(&self) -> f64 {
        self.capacity
    }

    #[must_use]
    pub fn energy(&self) -> f64 {
        self.energy
    }

    #[must_use]
    pub fn efficiency(&self) -> f64 {
        self.efficiency
    }

    #[must_use]
    pub fn deployed(&self) -> f64 {
        self.deployed
    }

    #[must_use]
    pub fn harvested(&self) -> f64 {
        self.harvested
    }

    #[must_use]
    pub fn max_power(&self, speed: f64) -> f64 {
        if speed <= self.taper_start {
            self.motor_power
        } else if speed >= self.taper_end {
            0.0
        } else {
            self.motor_power * (self.taper_end - speed) / (self.taper_end - self.taper_start)
        }
    }

    pub fn step(&mut self, power: f64, speed: f64, dt: f64) -> Result<f64, PowertrainError> {
        let power = finite(power, PowertrainError::Power)?;
        let speed = non_negative(speed, PowertrainError::CarSpeed)?;
        let dt = time_step(dt)?;
        if power > 0.0 {
            Ok(self.deploy(power.min(self.max_power(speed)), dt))
        } else {
            Ok(self.harvest(power.max(-self.motor_power), dt))
        }
    }

    fn deploy(&mut self, power: f64, dt: f64) -> f64 {
        let drawn = power * dt / self.efficiency;
        if drawn <= self.energy {
            self.energy -= drawn;
            self.deployed += drawn;
            power
        } else {
            let drawn = self.energy;
            self.energy = 0.0;
            self.deployed += drawn;
            drawn * self.efficiency / dt
        }
    }

    fn harvest(&mut self, power: f64, dt: f64) -> f64 {
        let stored = -power * dt * self.efficiency;
        let filled = self.energy + stored;
        if filled <= self.capacity {
            self.energy = filled;
            self.harvested += stored;
            power
        } else {
            let stored = self.capacity - self.energy;
            self.energy = self.capacity;
            self.harvested += stored;
            -stored / (dt * self.efficiency)
        }
    }
}
