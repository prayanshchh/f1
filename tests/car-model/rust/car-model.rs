use car::{Car, DT, Ground};
use contracts::{Input, Quat, Vec3};

fn flat() -> [Ground; 4] {
    [Ground {
        height: 0.0,
        normal: [0.0, 1.0, 0.0],
    }; 4]
}
fn start() -> Result<Car, String> {
    Car::new(
        Vec3 {
            x: 0.0,
            y: 0.30,
            z: 0.0,
        },
        Quat {
            x: 0.0,
            y: 0.0,
            z: 0.0,
            w: 1.0,
        },
        &flat(),
    )
}
fn input(throttle: f64, brake: f64, steer: f64) -> Input {
    Input {
        throttle,
        brake,
        steer,
        shift_up: false,
        shift_down: false,
    }
}
fn length(v: &Vec3) -> f64 {
    libm::sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
}
fn speed(car: &Car) -> f64 {
    length(&car.report().velocity)
}
fn forward_speed(car: &Car) -> f64 {
    let r = car.report();
    let q = r.orientation;
    r.velocity.x * 2.0 * (q.x * q.z + q.w * q.y)
        + r.velocity.y * 2.0 * (q.y * q.z - q.w * q.x)
        + r.velocity.z * (1.0 - 2.0 * (q.x * q.x + q.y * q.y))
}
fn driver_shift(car: &Car, i: &mut Input, held: &mut bool) {
    i.shift_up = !*held && car.report().engine_rpm >= 11900.0 && car.report().gear < 8;
    *held = i.shift_up;
}
fn launch_throttle(prev: f64, car: &Car) -> f64 {
    let w = car.report().wheels;
    (prev
        + if w[2].slip_ratio.max(w[3].slip_ratio) > 0.10 {
            -0.05
        } else {
            0.05
        })
    .clamp(0.0, 1.0)
}
fn accelerate(car: &mut Car, target: f64) -> Result<(), String> {
    let mut held = false;
    let mut throttle = 0.0;
    for tick in 0..30000 {
        if speed(car) >= target {
            return Ok(());
        }
        throttle = if tick < 1500 {
            launch_throttle(throttle, car)
        } else {
            1.0
        };
        let mut i = input(throttle, 0.0, 0.0);
        driver_shift(car, &mut i, &mut held);
        car.step(&i, &flat())?;
    }
    Err(format!("did not reach {target}, speed {}", speed(car)))
}
fn plane(grade: f64, car: &Car) -> [Ground; 4] {
    let n = libm::sqrt(1.0 + grade * grade);
    car.wheel_points().map(|p| Ground {
        height: grade * p.z,
        normal: [0.0, 1.0 / n, -grade / n],
    })
}
fn bytes(car: &Car) -> Result<Vec<u8>, String> {
    bincode::serialize(car).map_err(|e| e.to_string())
}

#[test]
fn a_new_car_is_parked_exactly_at_rest() -> Result<(), String> {
    let mut car = start()?;
    let r = car.report();
    for _ in 0..2500 {
        car.step(&input(0.0, 0.0, 0.0), &flat())?;
        assert_eq!(car.report(), r);
    }
    Ok(())
}

#[test]
fn zero_to_100_kmh_takes_about_2_6_seconds() -> Result<(), String> {
    let mut car = start()?;
    let mut throttle = 0.0;
    let mut held = false;
    for tick in 1..=2000 {
        throttle = launch_throttle(throttle, &car);
        let mut i = input(throttle, 0.0, 0.0);
        driver_shift(&car, &mut i, &mut held);
        car.step(&i, &flat())?;
        if forward_speed(&car) >= 100.0 / 3.6 {
            let time = f64::from(tick) * DT;
            assert!((2.4..=2.9).contains(&time), "0-100: {time}");
            return Ok(());
        }
    }
    Err(format!("launch failed: {}", speed(&car)))
}

#[test]
fn full_throttle_holds_340_to_350_kmh() -> Result<(), String> {
    let mut car = start()?;
    let mut throttle = 0.0;
    let mut held = false;
    let mut peak = 0.0_f64;
    let mut low = f64::INFINITY;
    let mut high = 0.0_f64;
    for tick in 0..30000 {
        throttle = if tick < 1500 {
            launch_throttle(throttle, &car)
        } else {
            1.0
        };
        let mut i = input(throttle, 0.0, 0.0);
        driver_shift(&car, &mut i, &mut held);
        car.step(&i, &flat())?;
        let v = speed(&car) * 3.6;
        peak = peak.max(v);
        if tick >= 27500 {
            low = low.min(v);
            high = high.max(v);
        }
    }
    assert!(
        (340.0..=350.0).contains(&peak),
        "peak {peak}, final {}, energy {}",
        speed(&car) * 3.6,
        car.report().battery_energy
    );
    assert!(high - low < 1.0, "range {low}..{high}");
    assert_eq!(car.report().straight_mode, 1.0);
    Ok(())
}

#[test]
fn peak_braking_is_about_5g() -> Result<(), String> {
    let mut car = start()?;
    accelerate(&mut car, 300.0 / 3.6)?;
    let mut brake = 1.0_f64;
    let mut peak = 0.0_f64;
    let mut previous = speed(&car);
    for tick in 1..=10000 {
        brake = (brake
            + if car.report().wheels.iter().any(|w| w.slip_ratio < -0.15) {
                -0.05
            } else {
                0.05
            })
        .clamp(0.0, 1.0);
        car.step(&input(0.0, brake, 0.0), &flat())?;
        assert!(
            forward_speed(&car) >= -0.01,
            "backwards {}",
            forward_speed(&car)
        );
        if tick % 50 == 0 {
            let now = speed(&car);
            peak = peak.max((previous - now) / 0.1 / chassis::GRAVITY);
            previous = now;
        }
        if speed(&car) == 0.0 {
            assert!((4.5..=6.5).contains(&peak), "braking {peak}");
            return Ok(());
        }
    }
    Err(format!("did not stop: {}, peak {peak}", speed(&car)))
}

fn cornering(target: f64) -> Result<f64, String> {
    let mut car = start()?;
    accelerate(&mut car, target)?;
    let mut steer = 0.0_f64;
    let mut peak = 0.0_f64;
    let mut sum = 0.0;
    let mut last_yaw = 0.0;
    let mut falling = 0;
    for tick in 1..=3000 {
        steer = (steer + 0.0005).min(1.0);
        let throttle = (0.2 * (target - speed(&car))).clamp(0.0, 1.0);
        let before = car.report();
        car.step(&input(throttle, 0.0, steer), &flat())?;
        let after = car.report();
        let yaw = after.angular_velocity.y;
        let q = before.orientation;
        let left_x = 1.0 - 2.0 * (q.y * q.y + q.z * q.z);
        let left_z = 2.0 * (q.x * q.z - q.w * q.y);
        sum += ((after.velocity.x - before.velocity.x) * left_x
            + (after.velocity.z - before.velocity.z) * left_z)
            / DT
            / chassis::GRAVITY;
        if tick % 50 == 0 {
            peak = peak.max(sum / 50.0);
            sum = 0.0;
        }
        falling = if yaw < last_yaw { falling + 1 } else { 0 };
        if falling >= 100 {
            break;
        }
        last_yaw = yaw;
    }
    Ok(peak)
}

#[test]
fn peak_cornering_is_about_5g() -> Result<(), String> {
    let fast = cornering(280.0 / 3.6)?;
    let slow = cornering(100.0 / 3.6)?;
    assert!((4.5..=6.0).contains(&fast), "fast {fast}, slow {slow}");
    assert!((1.8..=3.2).contains(&slow), "slow {slow}");
    Ok(())
}

#[test]
fn positive_steer_turns_left_and_steering_is_symmetric() -> Result<(), String> {
    let mut left = start()?;
    accelerate(&mut left, 20.0)?;
    let mut right = left.clone();
    for _ in 0..1000 {
        left.step(&input(0.3, 0.0, 0.2), &flat())?;
        right.step(&input(0.3, 0.0, -0.2), &flat())?;
    }
    let l = left.report();
    let r = right.report();
    assert!(l.position.x > 2.0 && l.angular_velocity.y > 0.0);
    assert!((l.position.x + r.position.x).abs() <= 1e-6 * l.position.x.abs());
    assert!((l.position.z - r.position.z).abs() <= 1e-6 * l.position.z.abs());
    Ok(())
}

#[test]
fn zero_steer_drives_straight() -> Result<(), String> {
    let mut car = start()?;
    let mut held = false;
    for _ in 0..5000 {
        let mut i = input(1.0, 0.0, 0.0);
        driver_shift(&car, &mut i, &mut held);
        car.step(&i, &flat())?;
    }
    let r = car.report();
    assert!(r.position.x.abs() < 1e-6);
    assert!(r.angular_velocity.y.abs() < 1e-6);
    assert!(r.angular_velocity.z.abs() < 1e-6);
    assert!(r.angular_velocity.x.abs() < 0.01);
    Ok(())
}

#[test]
fn downforce_loads_the_tyres_at_speed() -> Result<(), String> {
    let mut car = start()?;
    accelerate(&mut car, 250.0 / 3.6)?;
    for _ in 0..2000 {
        let throttle = (0.2 * (250.0 / 3.6 - speed(&car))).clamp(0.0, 0.99);
        car.step(&input(throttle, 0.0, 0.0), &flat())?;
    }
    let w = car.report().wheels;
    assert!(w.iter().map(|w| w.load).sum::<f64>() >= 1.8 * 800.0 * chassis::GRAVITY);
    let share = w[0].load / (w[0].load + w[1].load);
    assert!((0.35..=0.55).contains(&share));
    Ok(())
}

#[test]
fn hills_change_the_speed() -> Result<(), String> {
    let mut level = start()?;
    accelerate(&mut level, 30.0)?;
    let mut uphill = level.clone();
    let origin = uphill.report().position.z;
    for _ in 0..1500 {
        let mut g = plane(0.05, &uphill);
        for point in &mut g {
            point.height -= 0.05 * origin;
        }
        uphill.step(&input(0.0, 0.0, 0.0), &g)?;
        level.step(&input(0.0, 0.0, 0.0), &flat())?;
    }
    assert!(
        speed(&level) - speed(&uphill) >= 0.05 * chassis::GRAVITY * 3.0 * 0.8,
        "level {}, uphill {}",
        speed(&level),
        speed(&uphill)
    );
    Ok(())
}

#[test]
fn coasting_never_speeds_up_on_the_flat() -> Result<(), String> {
    let mut car = start()?;
    accelerate(&mut car, 200.0 / 3.6)?;
    for _ in 0..5000 {
        let before = speed(&car);
        car.step(&input(0.0, 0.0, 0.0), &flat())?;
        assert!(
            speed(&car) <= before + 1e-3,
            "coast before {before} after {}, report {:?}",
            speed(&car),
            car.report()
        );
    }
    assert!(speed(&car) * 3.6 < 150.0);
    Ok(())
}

#[test]
fn shifting_changes_gear_one_per_press() -> Result<(), String> {
    let mut car = start()?;
    let mut i = input(0.0, 0.0, 0.0);
    for _ in 0..3 {
        i.shift_up = true;
        car.step(&i, &flat())?;
        i.shift_up = false;
        car.step(&i, &flat())?;
    }
    assert_eq!(car.report().gear, 4);
    i.shift_down = true;
    car.step(&i, &flat())?;
    assert_eq!(car.report().gear, 3);
    Ok(())
}

fn random(seed: &mut u32) -> f64 {
    *seed ^= *seed << 13;
    *seed ^= *seed >> 17;
    *seed ^= *seed << 5;
    f64::from(*seed) / f64::from(u32::MAX)
}
fn random_input(seed: &mut u32) -> Input {
    Input {
        steer: random(seed) * 2.0 - 1.0,
        throttle: random(seed),
        brake: random(seed),
        shift_up: random(seed) < 0.01,
        shift_down: random(seed) < 0.01,
    }
}

#[test]
fn random_driving_never_fails() -> Result<(), String> {
    let mut car = start()?;
    let mut seed = 42;
    for _ in 0..50000 {
        let g = plane(0.03, &car);
        car.step(&random_input(&mut seed), &g)?;
        car.validate()?;
        let r = car.report();
        assert!(
            [
                r.position.x,
                r.position.y,
                r.position.z,
                r.velocity.x,
                r.velocity.y,
                r.velocity.z,
                r.orientation.x,
                r.orientation.y,
                r.orientation.z,
                r.orientation.w,
                r.angular_velocity.x,
                r.angular_velocity.y,
                r.angular_velocity.z,
                r.engine_rpm,
                r.battery_energy,
                r.ers_power,
                r.straight_mode,
                r.steer_angle
            ]
            .iter()
            .all(|v| v.is_finite())
        );
        assert!(r.wheels.iter().all(|w| {
            [w.spin, w.slip_ratio, w.slip_angle, w.load]
                .iter()
                .all(|v| v.is_finite())
        }));
    }
    Ok(())
}

#[test]
fn invalid_inputs_are_errors_and_change_nothing() -> Result<(), String> {
    let mut car = start()?;
    for _ in 0..500 {
        car.step(&input(0.5, 0.0, 0.0), &flat())?;
    }
    let before = bytes(&car)?;
    let report = car.report();
    for i in [
        input(0.0, 0.0, f64::NAN),
        input(0.0, 0.0, 1.000001),
        input(-0.1, 0.0, 0.0),
        input(0.0, 2.0, 0.0),
        input(f64::INFINITY, 0.0, 0.0),
    ] {
        assert!(car.step(&i, &flat()).is_err());
        assert_eq!(bytes(&car)?, before);
        assert_eq!(car.report(), report);
    }
    for bad in [
        Ground {
            height: 0.0,
            normal: [0.0, 0.0, 1.0],
        },
        Ground {
            height: f64::NAN,
            normal: [0.0, 1.0, 0.0],
        },
    ] {
        assert!(car.step(&input(0.0, 0.0, 0.0), &[bad; 4]).is_err());
        assert_eq!(bytes(&car)?, before);
    }
    Ok(())
}

#[test]
fn identical_runs_are_bit_identical_and_serde_round_trips() -> Result<(), String> {
    let mut a = start()?;
    let mut b = start()?;
    let mut seed = 123;
    for tick in 0..5000 {
        let i = random_input(&mut seed);
        a.step(&i, &flat())?;
        b.step(&i, &flat())?;
        if tick == 2500 {
            b = bincode::deserialize(&bytes(&b)?).map_err(|e| e.to_string())?;
        }
    }
    assert_eq!(bytes(&a)?, bytes(&b)?);
    Ok(())
}
