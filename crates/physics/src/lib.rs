mod track;

use bincode::Options;
use contracts::{CarState, Input, MAX_CARS, Quat, Snapshot, Vec3, WheelState, WorldSetup};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Serialize, Deserialize)]
struct Racer {
    car: car::Car,
    distance: f64,
    lap: i64,
    segment: u32,
}

#[derive(Clone, Serialize, Deserialize)]
struct State {
    setup: WorldSetup,
    tick: u32,
    racers: Vec<Racer>,
}

struct Segment {
    from: Vec3,
    delta: Vec3,
    length: f64,
    start: f64,
    normal: Vec3,
    orientation: Quat,
}

pub struct World {
    state: State,
    segments: Vec<Segment>,
    length: f64,
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
            normal: track::normal(&forward),
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
        for car in &setup.cars {
            if !ids.insert(car.id)
                || !car.start_distance.is_finite()
                || !(0.0..length).contains(&car.start_distance)
            {
                return Err(
                    "car ids must be unique and start distances must be within the lap".into(),
                );
            }
        }
        let mut world = Self {
            state: State {
                setup,
                tick: 0,
                racers: Vec::new(),
            },
            segments,
            length,
        };
        for setup in &world.state.setup.cars {
            world.state.racers.push(world.start(setup.start_distance)?);
        }
        Ok(world)
    }

    fn start(&self, distance: f64) -> Result<Racer, String> {
        let i = self
            .segments
            .iter()
            .position(|s| distance < s.start + s.length)
            .ok_or("invalid start distance")?;
        let s = &self.segments[i];
        let offset = scale(&s.delta, (distance - s.start) / s.length);
        let position = Vec3 {
            x: s.from.x + offset.x,
            y: s.from.y + offset.y + car::REST_HEIGHT,
            z: s.from.z + offset.z,
        };
        let forward = scale(&s.delta, 1.0 / s.length);
        let horizontal = libm::sqrt(forward.x * forward.x + forward.z * forward.z);
        let left = Vec3 {
            x: forward.z / horizontal,
            y: 0.0,
            z: -forward.x / horizontal,
        };
        let ground = [
            (chassis::HALF_TRACK, chassis::FRONT_AXLE),
            (-chassis::HALF_TRACK, chassis::FRONT_AXLE),
            (chassis::HALF_TRACK, -chassis::REAR_AXLE),
            (-chassis::HALF_TRACK, -chassis::REAR_AXLE),
        ]
        .map(|(x, z)| {
            let point = Vec3 {
                x: position.x + x * left.x + z * forward.x,
                y: position.y + z * forward.y,
                z: position.z + x * left.z + z * forward.z,
            };
            self.ground_at(&point, i as u32)
        });
        let car = car::Car::new(position, s.orientation.clone(), &ground)?;
        Ok(Racer {
            car,
            distance,
            lap: 0,
            segment: i as u32,
        })
    }

    pub fn step(&mut self, inputs: &[Input]) -> Result<(), String> {
        if inputs.len() != self.state.racers.len()
            || inputs.iter().any(|input| {
                !(-1.0..=1.0).contains(&input.steer)
                    || !(0.0..=1.0).contains(&input.throttle)
                    || !(0.0..=1.0).contains(&input.brake)
            })
        {
            return Err("provide one valid input per car".into());
        }
        let tick = self.state.tick.checked_add(1).ok_or("tick overflow")?;
        let mut next = self.state.racers.clone();
        for (racer, input) in next.iter_mut().zip(inputs) {
            let ground = racer
                .car
                .wheel_points()
                .map(|p| self.ground_at(&p, racer.segment));
            racer.car.step(input, &ground)?;
            let report = racer.car.report();
            if report.velocity.x == 0.0 && report.velocity.y == 0.0 && report.velocity.z == 0.0 {
                continue;
            }
            let (segment, d) = self.project(&report.position, racer.segment);
            let delta = d - racer.distance;
            if delta < -self.length / 2.0 {
                racer.lap = racer.lap.checked_add(1).ok_or("lap overflow")?;
            }
            if delta > self.length / 2.0 {
                racer.lap = racer.lap.checked_sub(1).ok_or("lap overflow")?;
            }
            racer.distance = d;
            racer.segment = segment;
        }
        self.state.racers = next;
        self.state.tick = tick;
        Ok(())
    }

    pub fn snapshot(&self) -> Snapshot {
        let cars = self
            .state
            .setup
            .cars
            .iter()
            .zip(&self.state.racers)
            .map(|(setup, racer)| {
                let report = racer.car.report();
                CarState {
                    id: setup.id,
                    position: report.position,
                    orientation: report.orientation,
                    velocity: report.velocity,
                    angular_velocity: report.angular_velocity,
                    lap: u32::try_from(racer.lap.max(0)).unwrap_or(u32::MAX),
                    lap_distance: racer.distance,
                    gear: report.gear,
                    engine_rpm: report.engine_rpm,
                    battery_energy: report.battery_energy,
                    ers_power: report.ers_power,
                    straight_mode: report.straight_mode,
                    steer_angle: report.steer_angle,
                    wheels: report.wheels.map(|w| WheelState {
                        spin: w.spin,
                        slip_ratio: w.slip_ratio,
                        slip_angle: w.slip_angle,
                        load: w.load,
                    }),
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
        if state.racers.len() != world.state.racers.len()
            || state.racers.iter().any(|r| {
                !r.distance.is_finite()
                    || !(0.0..world.length).contains(&r.distance)
                    || r.segment as usize >= world.segments.len()
                    || r.car.validate().is_err()
            })
        {
            return Err("invalid saved car state".into());
        }
        world.state = state;
        Ok(world)
    }
}
