use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Gearbox {
    ratios: [f64; 8],
}

impl Gearbox {
    #[must_use]
    pub fn eight_speed() -> Self {
        let steps = [1.26, 1.22, 1.19, 1.16, 1.14, 1.12, 1.10];
        let mut ratios = [4.79; 8];
        for index in (0..steps.len()).rev() {
            ratios[index] = ratios[index + 1] * steps[index];
        }
        Self { ratios }
    }

    #[must_use]
    pub fn ratios(&self) -> [f64; 8] {
        self.ratios
    }
}
