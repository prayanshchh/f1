mod math;

use bincode::Options;
use contracts::{PHYSICS_HZ, Quat, Vec3};
use math::{Rotation, V3};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const DT: f64 = 1.0 / PHYSICS_HZ as f64;
pub const GRAVITY: f64 = 9.80665;

const MASS: f64 = 800.0;
const INERTIA: V3 = V3::new(950.0, 1050.0, 200.0);
const HALF_TRACK: f64 = 0.8;
const FRONT_AXLE: f64 = 1.98;
const REAR_AXLE: f64 = 1.62;
const SPRING_LENGTH: f64 = 0.33;
const STATIC_COMPRESSION: f64 = 0.03;
const BUMP_START: f64 = 0.06;
const BUMP_RATE: f64 = 3.0e6;
const DAMPING_RATIO: f64 = 0.8;
const GRIP: f64 = 1.2;
const SCRUB: f64 = 5000.0;
const UNIT_TOLERANCE: f64 = 1e-9;
const CHECKSUM_BYTES: usize = 32;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DropStart {
    pub position: Vec3,
    pub orientation: Quat,
    pub velocity: Vec3,
    pub angular_velocity: Vec3,
    pub ground_height: f64,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CornerState {
    pub compression: f64,
    pub load: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChassisState {
    pub tick: u32,
    pub position: Vec3,
    pub orientation: Quat,
    pub velocity: Vec3,
    pub angular_velocity: Vec3,
    pub corners: [CornerState; 4],
}

#[derive(Clone, Serialize, Deserialize)]
struct Body {
    tick: u32,
    ground: f64,
    position: V3,
    orientation: Rotation,
    velocity: V3,
    spin: V3,
}

struct Mount {
    anchor: V3,
    rate: f64,
    damping: f64,
}

struct Contact {
    corner: CornerState,
    arm: V3,
    force: V3,
}

pub struct Chassis {
    body: Body,
    corners: [CornerState; 4],
}

fn mounts() -> [Mount; 4] {
    let wheelbase = FRONT_AXLE + REAR_AXLE;
    let axle = |z: f64, share: f64| {
        let mass = MASS * share * 0.5;
        let rate = mass * GRAVITY / STATIC_COMPRESSION;
        let damping = 2.0 * DAMPING_RATIO * libm::sqrt(rate * mass);
        [HALF_TRACK, -HALF_TRACK].map(|x| Mount {
            anchor: V3::new(x, 0.0, z),
            rate,
            damping,
        })
    };
    let [fl, fr] = axle(FRONT_AXLE, REAR_AXLE / wheelbase);
    let [rl, rr] = axle(-REAR_AXLE, FRONT_AXLE / wheelbase);
    [fl, fr, rl, rr]
}

fn contact(body: &Body, mount: &Mount) -> Contact {
    let anchor = body.orientation.rotate(mount.anchor);
    let compression = SPRING_LENGTH - (body.position.y + anchor.y - body.ground);
    if compression <= 0.0 {
        return Contact {
            corner: CornerState {
                compression: 0.0,
                load: 0.0,
            },
            arm: V3::ZERO,
            force: V3::ZERO,
        };
    }
    let arm = V3::new(anchor.x, body.ground - body.position.y, anchor.z);
    let motion = body.velocity + body.spin.cross(arm);
    let bump = (compression - BUMP_START).max(0.0) * BUMP_RATE;
    let load = (mount.rate * compression - mount.damping * motion.y + bump).max(0.0);
    let sliding = libm::sqrt(motion.x * motion.x + motion.z * motion.z);
    let scrub = if sliding > 0.0 {
        (SCRUB * sliding).min(GRIP * load) / sliding
    } else {
        0.0
    };
    Contact {
        corner: CornerState { compression, load },
        arm,
        force: V3::new(-motion.x * scrub, load, -motion.z * scrub),
    }
}

fn contacts(body: &Body) -> [Contact; 4] {
    mounts().map(|mount| contact(body, &mount))
}

fn angular_momentum(orientation: Rotation, spin: V3) -> V3 {
    orientation.rotate(orientation.unrotate(spin).scaled(INERTIA))
}

fn spin_from(orientation: Rotation, momentum: V3) -> V3 {
    orientation.rotate(orientation.unrotate(momentum).divided(INERTIA))
}

fn digest(bytes: &[u8]) -> Vec<u8> {
    Sha256::digest(bytes).to_vec()
}

impl Body {
    fn is_valid(&self) -> bool {
        self.position.is_finite()
            && self.velocity.is_finite()
            && self.spin.is_finite()
            && self.ground.is_finite()
            && self.orientation.is_finite()
            && (self.orientation.norm() - 1.0).abs() <= UNIT_TOLERANCE
    }

    fn is_buried(&self) -> bool {
        let clearance = SPRING_LENGTH - BUMP_START;
        self.position.y - self.ground < clearance
            || mounts().iter().any(|mount| {
                self.position.y + self.orientation.rotate(mount.anchor).y - self.ground < clearance
            })
    }

    fn next(&self) -> Result<Self, String> {
        let tick = self
            .tick
            .checked_add(1)
            .ok_or("the tick counter overflowed")?;
        let (force, torque) =
            contacts(self)
                .iter()
                .fold((V3::ZERO, V3::ZERO), |(force, torque), contact| {
                    (
                        force + contact.force,
                        torque + contact.arm.cross(contact.force),
                    )
                });
        let velocity = self.velocity + V3::new(0.0, -GRAVITY * DT, 0.0) + force * (DT / MASS);
        let momentum = angular_momentum(self.orientation, self.spin) + torque * DT;
        let orientation = self
            .orientation
            .turned(spin_from(self.orientation, momentum), DT);
        let next = Self {
            tick,
            ground: self.ground,
            position: self.position + velocity * DT,
            orientation,
            velocity,
            spin: spin_from(orientation, momentum),
        };
        if next.is_valid() {
            Ok(next)
        } else {
            Err("the chassis state became non-finite".into())
        }
    }
}

impl Chassis {
    pub fn new(start: DropStart) -> Result<Self, String> {
        let body = Body {
            tick: 0,
            ground: start.ground_height,
            position: V3::from(&start.position),
            orientation: Rotation::from(&start.orientation),
            velocity: V3::from(&start.velocity),
            spin: V3::from(&start.angular_velocity),
        };
        if !body.is_valid() {
            return Err("the start must be finite with a unit orientation quaternion".into());
        }
        if body.is_buried() {
            return Err("the car must not start buried in the ground".into());
        }
        Ok(Self::from_body(body))
    }

    fn from_body(body: Body) -> Self {
        let corners = contacts(&body).map(|contact| contact.corner);
        Self { body, corners }
    }

    pub fn step(&mut self) -> Result<(), String> {
        *self = Self::from_body(self.body.next()?);
        Ok(())
    }

    pub fn mass(&self) -> f64 {
        MASS
    }

    pub fn state(&self) -> ChassisState {
        ChassisState {
            tick: self.body.tick,
            position: self.body.position.into(),
            orientation: self.body.orientation.into(),
            velocity: self.body.velocity.into(),
            angular_velocity: self.body.spin.into(),
            corners: self.corners,
        }
    }

    fn encoded(&self) -> Result<Vec<u8>, String> {
        bincode::serialize(&self.body).map_err(|e| e.to_string())
    }

    pub fn state_hash(&self) -> Result<String, String> {
        Ok(digest(&self.encoded()?)
            .iter()
            .take(8)
            .map(|byte| format!("{byte:02x}"))
            .collect())
    }

    pub fn save(&self) -> Result<Vec<u8>, String> {
        let mut bytes = self.encoded()?;
        bytes.extend(digest(&bytes));
        Ok(bytes)
    }

    pub fn load(bytes: &[u8]) -> Result<Self, String> {
        let end = bytes
            .len()
            .checked_sub(CHECKSUM_BYTES)
            .ok_or("the save is too short")?;
        let (payload, checksum) = bytes.split_at(end);
        if digest(payload) != checksum {
            return Err("the save checksum does not match".into());
        }
        let body: Body = bincode::DefaultOptions::new()
            .with_fixint_encoding()
            .with_limit(payload.len() as u64)
            .reject_trailing_bytes()
            .deserialize(payload)
            .map_err(|e| e.to_string())?;
        if !body.is_valid() {
            return Err("the saved chassis state is invalid".into());
        }
        Ok(Self::from_body(body))
    }
}
