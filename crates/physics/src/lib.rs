use bincode::Options;
use contracts::{CarState, Input, MAX_CARS, PHYSICS_HZ, Quat, Snapshot, Vec3, WorldSetup};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Serialize, Deserialize)]
struct Motion {
    distance: f64,
    speed: f64,
    lap: u32,
}

#[derive(Clone, Serialize, Deserialize)]
struct State {
    setup: WorldSetup,
    tick: u32,
    motion: Vec<Motion>,
}

struct Segment {
    from: Vec3,
    delta: Vec3,
    length: f64,
    start: f64,
    forward: Vec3,
    orientation: Quat,
}

pub struct World {
    state: State,
    segments: Vec<Segment>,
    length: f64,
}

fn zero() -> Vec3 {
    Vec3 {
        x: 0.0,
        y: 0.0,
        z: 0.0,
    }
}

fn scale(v: &Vec3, factor: f64) -> Vec3 {
    Vec3 {
        x: v.x * factor,
        y: v.y * factor,
        z: v.z * factor,
    }
}

fn norm(v: &Vec3) -> f64 {
    libm::sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
}

fn orientation(f: &Vec3) -> Quat {
    let horizontal = libm::sqrt(f.x * f.x + f.z * f.z);
    let yaw = libm::atan2(f.x, f.z) * 0.5;
    let pitch = -libm::atan2(f.y, horizontal) * 0.5;
    let sy = libm::sin(yaw);
    let cy = libm::cos(yaw);
    let sp = libm::sin(pitch);
    let cp = libm::cos(pitch);
    Quat {
        x: cy * sp + 0.0,
        y: sy * cp + 0.0,
        z: -sy * sp + 0.0,
        w: cy * cp + 0.0,
    }
}

fn segments(setup: &WorldSetup) -> Result<(Vec<Segment>, f64), String> {
    let track = &setup.track;
    if track.name.trim().is_empty()
        || !track.width.is_finite()
        || track.width <= 0.0
        || track.centerline.len() < 3
    {
        return Err("invalid track name, width or centerline".into());
    }
    let mut result = Vec::new();
    let mut start = 0.0;
    for (from, to) in track
        .centerline
        .iter()
        .zip(track.centerline.iter().cycle().skip(1))
    {
        if ![from.x, from.y, from.z].iter().all(|v| v.is_finite()) {
            return Err("track coordinates must be finite".into());
        }
        let delta = Vec3 {
            x: to.x - from.x,
            y: to.y - from.y,
            z: to.z - from.z,
        };
        let length = norm(&delta);
        let horizontal = libm::sqrt(delta.x * delta.x + delta.z * delta.z);
        if !length.is_finite() || length <= 0.0 || horizontal <= 0.0 {
            return Err(
                "track segments must have finite positive length and cannot be vertical".into(),
            );
        }
        let forward = scale(&delta, 1.0 / length);
        result.push(Segment {
            from: from.clone(),
            delta,
            length,
            start,
            orientation: orientation(&forward),
            forward,
        });
        start += length;
    }
    if !start.is_finite() {
        return Err("track length must be finite".into());
    }
    Ok((result, start))
}

fn digest(bytes: &[u8]) -> Vec<u8> {
    Sha256::digest(bytes).to_vec()
}

impl World {
    pub fn new(setup: WorldSetup) -> Result<Self, String> {
        let (segments, length) = segments(&setup)?;
        if setup.cars.is_empty() || setup.cars.len() > MAX_CARS {
            return Err("world must have 1 to 22 cars".into());
        }
        let mut ids = std::collections::HashSet::new();
        let mut motion = Vec::new();
        for car in &setup.cars {
            if !ids.insert(car.id)
                || !car.start_distance.is_finite()
                || !(0.0..length).contains(&car.start_distance)
            {
                return Err(
                    "car ids must be unique and start distances must be within the lap".into(),
                );
            }
            motion.push(Motion {
                distance: car.start_distance,
                speed: 0.0,
                lap: 0,
            });
        }
        Ok(Self {
            state: State {
                setup,
                tick: 0,
                motion,
            },
            segments,
            length,
        })
    }

    pub fn step(&mut self, inputs: &[Input]) -> Result<(), String> {
        if inputs.len() != self.state.motion.len()
            || inputs.iter().any(|input| {
                !(-1.0..=1.0).contains(&input.steer)
                    || !(0.0..=1.0).contains(&input.throttle)
                    || !(0.0..=1.0).contains(&input.brake)
            })
        {
            return Err("provide one valid input per car".into());
        }
        let tick = self.state.tick.checked_add(1).ok_or("tick overflow")?;
        let mut next = self.state.motion.clone();
        for (motion, input) in next.iter_mut().zip(inputs) {
            motion.speed = (motion.speed
                + (12.0 * input.throttle - 25.0 * input.brake) / f64::from(PHYSICS_HZ))
            .clamp(0.0, 85.0);
            motion.distance += motion.speed / f64::from(PHYSICS_HZ);
            let laps = libm::floor(motion.distance / self.length);
            if laps > f64::from(u32::MAX) {
                return Err("lap overflow".into());
            }
            let wraps = laps as u32;
            motion.lap = motion.lap.checked_add(wraps).ok_or("lap overflow")?;
            motion.distance %= self.length;
        }
        self.state.motion = next;
        self.state.tick = tick;
        Ok(())
    }

    pub fn snapshot(&self) -> Snapshot {
        let cars = self
            .state
            .setup
            .cars
            .iter()
            .zip(&self.state.motion)
            .map(|(car, motion)| {
                let segment = self
                    .segments
                    .iter()
                    .find(|s| motion.distance < s.start + s.length)
                    .or_else(|| self.segments.last());
                let (position, orientation, velocity) = match segment {
                    Some(s) => {
                        let offset = scale(&s.delta, (motion.distance - s.start) / s.length);
                        (
                            Vec3 {
                                x: s.from.x + offset.x,
                                y: s.from.y + offset.y,
                                z: s.from.z + offset.z,
                            },
                            s.orientation.clone(),
                            scale(&s.forward, motion.speed),
                        )
                    }
                    None => (
                        zero(),
                        Quat {
                            x: 0.0,
                            y: 0.0,
                            z: 0.0,
                            w: 1.0,
                        },
                        zero(),
                    ),
                };
                CarState {
                    id: car.id,
                    position,
                    orientation,
                    velocity,
                    angular_velocity: zero(),
                    lap: motion.lap,
                    lap_distance: motion.distance,
                }
            })
            .collect();
        Snapshot {
            tick: self.state.tick,
            cars,
        }
    }

    pub fn save(&self) -> Result<Vec<u8>, String> {
        let mut bytes = bincode::serialize(&self.state).map_err(|e| e.to_string())?;
        bytes.extend(digest(&bytes));
        Ok(bytes)
    }

    pub fn state_hash(&self) -> Result<String, String> {
        let bytes = bincode::serialize(&self.state).map_err(|e| e.to_string())?;
        Ok(digest(&bytes)
            .iter()
            .take(8)
            .map(|byte| format!("{byte:02x}"))
            .collect())
    }

    pub fn load(bytes: &[u8]) -> Result<Self, String> {
        let end = bytes.len().checked_sub(32).ok_or("save is too short")?;
        let (payload, checksum) = bytes.split_at(end);
        if digest(payload) != checksum {
            return Err("save checksum mismatch".into());
        }
        let state: State = bincode::DefaultOptions::new()
            .with_fixint_encoding()
            .with_limit(payload.len() as u64)
            .reject_trailing_bytes()
            .deserialize(payload)
            .map_err(|e| e.to_string())?;
        let mut world = Self::new(state.setup.clone())?;
        if state.motion.len() != world.state.motion.len()
            || state.motion.iter().any(|m| {
                !m.distance.is_finite()
                    || !(0.0..world.length).contains(&m.distance)
                    || !m.speed.is_finite()
                    || !(0.0..=85.0).contains(&m.speed)
            })
        {
            return Err("invalid saved motion".into());
        }
        world.state = state;
        Ok(world)
    }
}
