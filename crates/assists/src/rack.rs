use crate::AssistError;
use crate::error::{positive, range};
use serde::{Deserialize, Serialize};

pub const RACK_RATE: f64 = 3.0;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct SteeringRack {
    max_rate: f64,
    position: f64,
}

impl SteeringRack {
    pub fn new(max_rate: f64) -> Result<Self, AssistError> {
        positive(max_rate, AssistError::Rate)?;
        Ok(Self {
            max_rate,
            position: 0.0,
        })
    }

    #[must_use]
    pub fn position(&self) -> f64 {
        self.position
    }

    pub fn step(&mut self, command: f64, dt: f64) -> Result<f64, AssistError> {
        range(command, -1.0, 1.0, AssistError::Steer)?;
        positive(dt, AssistError::TimeStep)?;
        let limit = self.max_rate * dt;
        let difference = command - self.position;
        self.position = if difference.abs() <= limit {
            command
        } else {
            self.position + difference.clamp(-limit, limit)
        };
        Ok(self.position)
    }
}
