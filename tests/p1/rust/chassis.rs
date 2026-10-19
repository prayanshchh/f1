use chassis::{Chassis, ChassisState, DT, DropStart, GRAVITY};
use contracts::{PHYSICS_HZ, Quat, Vec3};

fn text<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

fn vec3(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3 { x, y, z }
}

fn identity() -> Quat {
    Quat {
        x: 0.0,
        y: 0.0,
        z: 0.0,
        w: 1.0,
    }
}

fn axis_angle(axis: (f64, f64, f64), degrees: f64) -> Quat {
    let half = degrees.to_radians() / 2.0;
    let size = (axis.0 * axis.0 + axis.1 * axis.1 + axis.2 * axis.2).sqrt();
    let s = half.sin() / size;
    Quat {
        x: axis.0 * s,
        y: axis.1 * s,
        z: axis.2 * s,
        w: half.cos(),
    }
}

fn rotate(q: &Quat, v: &Vec3) -> Vec3 {
    let tx = 2.0 * (q.y * v.z - q.z * v.y);
    let ty = 2.0 * (q.z * v.x - q.x * v.z);
    let tz = 2.0 * (q.x * v.y - q.y * v.x);
    vec3(
        v.x + q.w * tx + (q.y * tz - q.z * ty),
        v.y + q.w * ty + (q.z * tx - q.x * tz),
        v.z + q.w * tz + (q.x * ty - q.y * tx),
    )
}

fn length(v: &Vec3) -> f64 {
    (v.x * v.x + v.y * v.y + v.z * v.z).sqrt()
}

fn tilt_degrees(q: &Quat) -> f64 {
    rotate(q, &vec3(0.0, 1.0, 0.0))
        .y
        .clamp(-1.0, 1.0)
        .acos()
        .to_degrees()
}

fn drop_from(height: f64, orientation: Quat) -> DropStart {
    DropStart {
        position: vec3(3.0, height, -7.0),
        orientation,
        velocity: vec3(0.0, 0.0, 0.0),
        angular_velocity: vec3(0.0, 0.0, 0.0),
        ground_height: 0.0,
    }
}

fn chassis(start: DropStart) -> Result<Chassis, String> {
    Chassis::new(start).map_err(text)
}

fn run(car: &mut Chassis, ticks: u32) -> Result<Vec<ChassisState>, String> {
    let mut states = Vec::new();
    for _ in 0..ticks {
        car.step().map_err(text)?;
        states.push(car.state());
    }
    Ok(states)
}

fn hash(car: &Chassis) -> Result<String, String> {
    car.state_hash().map_err(text)
}

fn total_load(state: &ChassisState) -> f64 {
    state.corners.iter().map(|corner| corner.load).sum()
}

#[test]
fn the_step_is_fixed_at_the_physics_rate() {
    assert_eq!(DT, 1.0 / f64::from(PHYSICS_HZ));
    assert!((9.8..=9.81).contains(&GRAVITY));
}

#[test]
fn the_car_has_a_2026_mass() -> Result<(), String> {
    let mass = chassis(drop_from(1.0, identity()))?.mass();
    assert!((768.0..=850.0).contains(&mass), "mass {mass}");
    Ok(())
}

#[test]
fn a_new_chassis_reports_its_start_exactly() -> Result<(), String> {
    let start = DropStart {
        position: vec3(0.1234567890123456, 2.4681357924681357, -3.0987654321098765),
        orientation: axis_angle((0.3, 1.0, -0.2), 37.0),
        velocity: vec3(1.5, -0.25, 3.0),
        angular_velocity: vec3(0.01, -0.3, 0.2),
        ground_height: -0.75,
    };
    let state = chassis(start.clone())?.state();
    assert_eq!(state.tick, 0);
    assert_eq!(state.position.x.to_bits(), start.position.x.to_bits());
    assert_eq!(state.position.y.to_bits(), start.position.y.to_bits());
    assert_eq!(state.position.z.to_bits(), start.position.z.to_bits());
    assert_eq!(state.orientation.w.to_bits(), start.orientation.w.to_bits());
    assert_eq!(state.velocity.z.to_bits(), start.velocity.z.to_bits());
    assert_eq!(
        state.angular_velocity.y.to_bits(),
        start.angular_velocity.y.to_bits()
    );
    assert_eq!(state.corners.len(), 4);
    Ok(())
}

#[test]
fn free_fall_follows_gravity_exactly() -> Result<(), String> {
    let mut car = chassis(drop_from(80.0, identity()))?;
    for (index, state) in run(&mut car, 500)?.iter().enumerate() {
        let ticks = (index + 1) as f64;
        assert!((state.velocity.y + GRAVITY * DT * ticks).abs() < 1e-9);
        assert_eq!(state.velocity.x, 0.0);
        assert_eq!(state.velocity.z, 0.0);
        assert_eq!(state.orientation.w.to_bits(), 1.0_f64.to_bits());
        assert!(state.corners.iter().all(|corner| corner.load == 0.0));
        assert_eq!(state.tick as usize, index + 1);
    }
    Ok(())
}

#[test]
fn a_spinning_car_keeps_its_spin_and_a_unit_quaternion_in_free_fall() -> Result<(), String> {
    let mut start = drop_from(3000.0, identity());
    start.angular_velocity = vec3(0.0, 2.5, 0.0);
    let mut car = chassis(start)?;
    let states = run(&mut car, 10_000)?;
    for state in &states {
        assert!((state.angular_velocity.y - 2.5).abs() < 1e-9);
        let q = &state.orientation;
        let norm = (q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w).sqrt();
        assert!((norm - 1.0).abs() < 1e-12, "quaternion norm {norm}");
    }
    Ok(())
}

struct Settled {
    states: Vec<ChassisState>,
    mass: f64,
}

fn settle(start: DropStart, ticks: u32) -> Result<Settled, String> {
    let mut car = chassis(start)?;
    let mass = car.mass();
    Ok(Settled {
        states: run(&mut car, ticks)?,
        mass,
    })
}

#[test]
fn a_level_drop_settles_onto_its_springs() -> Result<(), String> {
    let settled = settle(drop_from(1.0, identity()), 2500)?;
    let last = settled.states.last().ok_or("no states")?;
    assert!(
        length(&last.velocity) < 1e-3,
        "still moving at {:?}",
        last.velocity
    );
    assert!(length(&last.angular_velocity) < 1e-3);
    let weight = settled.mass * GRAVITY;
    assert!((total_load(last) - weight).abs() <= weight * 0.005);
    let [fl, fr, rl, rr] = [0, 1, 2, 3].map(|index| last.corners[index].load);
    assert!((fl - fr).abs() <= fl * 1e-6 && (rl - rr).abs() <= rl * 1e-6);
    let front = (fl + fr) / (fl + fr + rl + rr);
    assert!((0.4..=0.5).contains(&front), "front weight share {front}");
    assert!(
        (0.2..=0.4).contains(&last.position.y),
        "rest height {}",
        last.position.y
    );
    assert!(last.corners.iter().all(|corner| corner.compression > 0.0));
    assert!(tilt_degrees(&last.orientation) < 0.05);
    Ok(())
}

#[test]
fn the_drop_is_well_damped() -> Result<(), String> {
    let settled = settle(drop_from(1.0, identity()), 2500)?;
    let rest = settled.states.last().ok_or("no states")?.position.y;
    let contact = settled
        .states
        .iter()
        .position(|state| total_load(state) > 0.0)
        .ok_or("the car never touched the ground")?;
    let heights: Vec<f64> = settled.states[contact..]
        .iter()
        .map(|state| state.position.y - rest)
        .filter(|height| height.abs() > 0.0005)
        .collect();
    let crossings = heights
        .windows(2)
        .filter(|pair| pair[0].signum() != pair[1].signum())
        .count();
    assert!(
        crossings <= 4,
        "{crossings} bounces bigger than half a millimetre"
    );
    for (index, state) in settled.states.iter().enumerate().skip(750) {
        assert!(
            (state.position.y - rest).abs() < 0.002,
            "not settled at tick {index}"
        );
    }
    Ok(())
}

#[test]
fn a_settled_car_stays_exactly_where_it_is() -> Result<(), String> {
    let mut car = chassis(drop_from(0.6, identity()))?;
    run(&mut car, 2500)?;
    let before = car.state();
    let states = run(&mut car, 10_000)?;
    for state in &states {
        assert!((state.position.y - before.position.y).abs() < 1e-6);
        assert!((state.position.x - before.position.x).abs() < 1e-6);
        assert!((state.position.z - before.position.z).abs() < 1e-6);
    }
    Ok(())
}

#[test]
fn a_tilted_drop_levels_out() -> Result<(), String> {
    let roll = axis_angle((0.0, 0.0, 1.0), 8.0);
    let pitch = axis_angle((1.0, 0.0, 0.0), -4.0);
    let orientation = Quat {
        x: roll.w * pitch.x + roll.x * pitch.w + roll.y * pitch.z - roll.z * pitch.y,
        y: roll.w * pitch.y - roll.x * pitch.z + roll.y * pitch.w + roll.z * pitch.x,
        z: roll.w * pitch.z + roll.x * pitch.y - roll.y * pitch.x + roll.z * pitch.w,
        w: roll.w * pitch.w - roll.x * pitch.x - roll.y * pitch.y - roll.z * pitch.z,
    };
    let settled = settle(drop_from(0.8, orientation), 3000)?;
    let last = settled.states.last().ok_or("no states")?;
    assert!(
        tilt_degrees(&last.orientation) < 0.2,
        "tilt {}",
        tilt_degrees(&last.orientation)
    );
    assert!(length(&last.velocity) < 0.01 && length(&last.angular_velocity) < 0.01);
    Ok(())
}

fn first_contact(start: DropStart) -> Result<[f64; 4], String> {
    let mut car = chassis(start)?;
    for _ in 0..2000 {
        car.step().map_err(text)?;
        let state = car.state();
        if total_load(&state) > 0.0 {
            return Ok([0, 1, 2, 3].map(|index| state.corners[index].load));
        }
    }
    Err("never touched the ground".into())
}

#[test]
fn corners_are_front_left_front_right_rear_left_rear_right() -> Result<(), String> {
    let left_down = first_contact(drop_from(0.9, axis_angle((0.0, 0.0, 1.0), -6.0)))?;
    assert!(left_down[0] > 0.0 && left_down[2] > 0.0, "{left_down:?}");
    assert!(left_down[1] == 0.0 && left_down[3] == 0.0, "{left_down:?}");
    let nose_down = first_contact(drop_from(0.9, axis_angle((1.0, 0.0, 0.0), 3.0)))?;
    assert!(nose_down[0] > 0.0 && nose_down[1] > 0.0, "{nose_down:?}");
    assert!(nose_down[2] == 0.0 && nose_down[3] == 0.0, "{nose_down:?}");
    Ok(())
}

#[test]
fn a_hard_drop_never_sinks_through_the_ground() -> Result<(), String> {
    let mut start = drop_from(2.5, identity());
    start.velocity = vec3(0.0, -6.0, 0.0);
    let settled = settle(start, 3000)?;
    let last = settled.states.last().ok_or("no states")?;
    assert!(length(&last.velocity) < 1e-3);
    let lowest = settled
        .states
        .iter()
        .map(|state| state.position.y)
        .fold(f64::INFINITY, f64::min);
    assert!(lowest.is_finite());
    assert!(
        lowest >= last.position.y - 0.12,
        "the body sank {} m below its rest height; bump stops must catch it",
        last.position.y - lowest
    );
    Ok(())
}

#[test]
fn raising_the_ground_raises_the_rest_height_by_the_same_amount() -> Result<(), String> {
    let low = settle(drop_from(1.0, identity()), 2500)?;
    let mut start = drop_from(13.5, identity());
    start.ground_height = 12.5;
    let high = settle(start, 2500)?;
    let a = low.states.last().ok_or("no states")?.position.y;
    let b = high.states.last().ok_or("no states")?.position.y;
    assert!((b - a - 12.5).abs() < 1e-6, "{a} vs {b}");
    Ok(())
}

#[test]
fn hashes_are_short_hex_and_change_while_the_car_moves() -> Result<(), String> {
    let mut car = chassis(drop_from(1.0, identity()))?;
    let mut previous = hash(&car)?;
    assert_eq!(previous.len(), 16);
    assert!(
        previous
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    );
    for _ in 0..300 {
        car.step().map_err(text)?;
        let current = hash(&car)?;
        assert_ne!(current, previous);
        previous = current;
    }
    Ok(())
}

#[test]
fn identical_starts_give_identical_hashes() -> Result<(), String> {
    let mut start = drop_from(1.3, axis_angle((0.2, 0.9, 0.4), 23.0));
    start.angular_velocity = vec3(0.4, -1.1, 0.7);
    start.velocity = vec3(2.0, 0.5, -1.0);
    let mut a = chassis(start.clone())?;
    let mut b = chassis(start)?;
    for _ in 0..5000 {
        a.step().map_err(text)?;
        b.step().map_err(text)?;
        assert_eq!(hash(&a)?, hash(&b)?);
    }
    Ok(())
}

#[test]
fn saving_and_loading_mid_bounce_continues_identically() -> Result<(), String> {
    let mut whole = chassis(drop_from(1.0, axis_angle((1.0, 0.0, 1.0), 5.0)))?;
    run(&mut whole, 300)?;
    let bytes = whole.save().map_err(text)?;
    let mut copy = Chassis::load(&bytes).map_err(text)?;
    assert_eq!(hash(&copy)?, hash(&whole)?);
    assert_eq!(copy.state().tick, 300);
    for _ in 0..2000 {
        whole.step().map_err(text)?;
        copy.step().map_err(text)?;
        assert_eq!(hash(&copy)?, hash(&whole)?);
    }
    assert_eq!(copy.save().map_err(text)?, whole.save().map_err(text)?);
    Ok(())
}

#[test]
fn damaged_saves_are_rejected() -> Result<(), String> {
    let mut car = chassis(drop_from(1.0, identity()))?;
    run(&mut car, 100)?;
    let bytes = car.save().map_err(text)?;
    assert!(Chassis::load(&[]).is_err());
    assert!(Chassis::load(&bytes[..bytes.len() - 1]).is_err());
    let mut longer = bytes.clone();
    longer.push(0);
    assert!(Chassis::load(&longer).is_err());
    for index in [0, bytes.len() / 3, bytes.len() / 2, bytes.len() - 1] {
        let mut damaged = bytes.clone();
        damaged[index] ^= 0x20;
        assert!(Chassis::load(&damaged).is_err(), "flipped byte {index}");
    }
    Ok(())
}

#[test]
fn impossible_starts_are_rejected() {
    let good = drop_from(1.0, identity());
    let mut bad = Vec::new();
    for value in [f64::NAN, f64::INFINITY] {
        let mut start = good.clone();
        start.position.x = value;
        bad.push(start);
        let mut start = good.clone();
        start.velocity.y = value;
        bad.push(start);
        let mut start = good.clone();
        start.angular_velocity.z = value;
        bad.push(start);
        let mut start = good.clone();
        start.orientation.w = value;
        bad.push(start);
        let mut start = good.clone();
        start.ground_height = value;
        bad.push(start);
    }
    let mut start = good.clone();
    start.orientation = Quat {
        x: 0.0,
        y: 0.0,
        z: 0.0,
        w: 1.01,
    };
    bad.push(start);
    let mut start = good.clone();
    start.position.y = 0.04;
    bad.push(start);
    let mut start = good;
    start.ground_height = 0.98;
    bad.push(start);
    for start in bad {
        assert!(Chassis::new(start).is_err());
    }
}
