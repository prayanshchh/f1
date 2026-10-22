mod abs;
mod error;
mod pedals;
mod rack;
mod slip;
mod traction;

pub use abs::{ABS_MIN_SPEED, Abs, AbsInput, AbsOutput};
pub use error::AssistError;
pub use pedals::{BRAKE_TIME, PedalPositions, Pedals, THROTTLE_TIME};
pub use rack::{RACK_RATE, SteeringRack};
use serde::{Deserialize, Serialize};
pub use slip::{MIN_SLIP_SPEED, slip_ratio};
pub use traction::{TractionControl, TractionInput, TractionOutput};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum AssistLevel {
    Off,
    Low,
    High,
}

impl AssistLevel {
    #[must_use]
    pub fn target_slip(self) -> Option<f64> {
        match self {
            Self::Off => None,
            Self::Low => Some(0.12),
            Self::High => Some(0.06),
        }
    }
}
