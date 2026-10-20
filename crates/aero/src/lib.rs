use serde::{Deserialize, Serialize};
use std::fmt;

const AIR_DENSITY: f64 = 1.225;
const TRANSITION_SECONDS: f64 = 0.4;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct AeroInput {
    pub airspeed: f64,
    pub front_ride_height: f64,
    pub rear_ride_height: f64,
    pub straight_mode: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct AeroForces {
    pub drag: f64,
    pub front_downforce: f64,
    pub rear_downforce: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AeroError {
    Airspeed,
    FrontRideHeight,
    RearRideHeight,
    StraightMode,
    TimeStep,
}

impl fmt::Display for AeroError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::Airspeed => "airspeed must be finite and not negative",
            Self::FrontRideHeight => "front ride height must be finite and not negative",
            Self::RearRideHeight => "rear ride height must be finite and not negative",
            Self::StraightMode => "straight mode must be between 0 and 1",
            Self::TimeStep => "time step must be finite and positive",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for AeroError {}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Aero {
    reference_front: f64,
    reference_rear: f64,
    body_drag_area: f64,
    wing_drag_area: f64,
    wing_lift_area: f64,
    floor_lift_area: f64,
    straight_wing_drag_cut: f64,
    straight_wing_lift_cut: f64,
    straight_floor_lift_cut: f64,
    floor_stall_width: f64,
    floor_lift_off_width: f64,
    balance: f64,
    balance_swing: f64,
    balance_rake_width: f64,
}

fn non_negative(value: f64, error: AeroError) -> Result<f64, AeroError> {
    if value.is_finite() && value >= 0.0 {
        Ok(value)
    } else {
        Err(error)
    }
}

impl Aero {
    pub fn car_2026() -> Self {
        Self {
            reference_front: 0.03,
            reference_rear: 0.07,
            body_drag_area: 0.6,
            wing_drag_area: 0.6,
            wing_lift_area: 1.8,
            floor_lift_area: 2.7,
            straight_wing_drag_cut: 0.5,
            straight_wing_lift_cut: 0.8,
            straight_floor_lift_cut: 0.25,
            floor_stall_width: 0.02,
            floor_lift_off_width: 0.05,
            balance: 0.44,
            balance_swing: 0.08,
            balance_rake_width: 0.03,
        }
    }

    pub fn reference_ride_heights(&self) -> (f64, f64) {
        (self.reference_front, self.reference_rear)
    }

    pub fn forces(&self, input: &AeroInput) -> Result<AeroForces, AeroError> {
        let airspeed = non_negative(input.airspeed, AeroError::Airspeed)?;
        let front = non_negative(input.front_ride_height, AeroError::FrontRideHeight)?;
        let rear = non_negative(input.rear_ride_height, AeroError::RearRideHeight)?;
        let straight = input.straight_mode;
        if !(0.0..=1.0).contains(&straight) {
            return Err(AeroError::StraightMode);
        }
        let pressure = 0.5 * AIR_DENSITY * (airspeed * airspeed);
        let drag_area = self.body_drag_area
            + self.wing_drag_area * (1.0 - self.straight_wing_drag_cut * straight);
        let lift_area = self.wing_lift_area * (1.0 - self.straight_wing_lift_cut * straight)
            + self.floor_lift_area
                * self.ground_effect(front, rear)
                * (1.0 - self.straight_floor_lift_cut * straight);
        let balance = self.front_balance(front, rear);
        Ok(AeroForces {
            drag: drag_area * pressure,
            front_downforce: lift_area * balance * pressure,
            rear_downforce: lift_area * (1.0 - balance) * pressure,
        })
    }

    fn ground_effect(&self, front: f64, rear: f64) -> f64 {
        let offset = 0.5 * (front + rear) - 0.5 * (self.reference_front + self.reference_rear);
        let width = if offset < 0.0 {
            self.floor_stall_width
        } else {
            self.floor_lift_off_width
        };
        let ratio = offset / width;
        libm::exp(-(ratio * ratio))
    }

    fn front_balance(&self, front: f64, rear: f64) -> f64 {
        let rake = (rear - front) - (self.reference_rear - self.reference_front);
        self.balance + self.balance_swing * libm::tanh(rake / self.balance_rake_width)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum AeroMode {
    #[default]
    Corner,
    Straight,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ActiveAero {
    mode: AeroMode,
    straight_mode: f64,
}

impl ActiveAero {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn request(&mut self, mode: AeroMode) {
        self.mode = mode;
    }

    pub fn mode(&self) -> AeroMode {
        self.mode
    }

    pub fn straight_mode(&self) -> f64 {
        self.straight_mode
    }

    pub fn step(&mut self, dt: f64) -> Result<(), AeroError> {
        if !(dt.is_finite() && dt > 0.0) {
            return Err(AeroError::TimeStep);
        }
        let travel = dt / TRANSITION_SECONDS;
        self.straight_mode = match self.mode {
            AeroMode::Straight => (self.straight_mode + travel).min(1.0),
            AeroMode::Corner => (self.straight_mode - travel).max(0.0),
        };
        Ok(())
    }
}
