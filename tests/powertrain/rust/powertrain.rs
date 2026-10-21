use powertrain::{
    Brakes, Differential, Engine, Ers, Gearbox, Powertrain, PowertrainInput, PowertrainOutput,
    WHEEL_RADIUS,
};
use std::f64::consts::PI;

const DT: f64 = 1.0 / 500.0;
const KMH: f64 = 1.0 / 3.6;

fn text<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

fn rpm_to_rad(rpm: f64) -> f64 {
    rpm * 2.0 * PI / 60.0
}

fn torque(engine: &Engine, rpm: f64, throttle: f64) -> Result<f64, String> {
    engine.torque(rpm, throttle).map_err(text)
}

fn relative(a: f64, b: f64) -> f64 {
    (a - b).abs() / b.abs().max(1e-9)
}

#[test]
fn the_engine_makes_2026_power_high_in_the_rev_range() -> Result<(), String> {
    let engine = Engine::v6_2026();
    let limiter = engine.limiter_rpm();
    assert!(
        (12_000.0..=15_000.0).contains(&limiter),
        "limiter {limiter}"
    );
    let idle = engine.idle_rpm();
    assert!((3_000.0..=6_000.0).contains(&idle), "idle {idle}");
    let mut best = (0.0, 0.0);
    let mut rpm = idle;
    while rpm < limiter {
        let power = torque(&engine, rpm, 1.0)? * rpm_to_rad(rpm);
        if power > best.1 {
            best = (rpm, power);
        }
        rpm += 10.0;
    }
    assert!(
        (350_000.0..=450_000.0).contains(&best.1),
        "peak power {}",
        best.1
    );
    assert!(
        (10_000.0..=12_500.0).contains(&best.0),
        "peak power rpm {}",
        best.0
    );
    Ok(())
}

#[test]
fn the_limiter_cuts_drive_and_a_closed_throttle_brakes_the_engine() -> Result<(), String> {
    let engine = Engine::v6_2026();
    for rpm in [engine.limiter_rpm(), engine.limiter_rpm() + 1.0, 20_000.0] {
        assert!(torque(&engine, rpm, 1.0)? <= 0.0, "rpm {rpm}");
    }
    for rpm in [
        engine.idle_rpm() + 500.0,
        9_000.0,
        engine.limiter_rpm() - 100.0,
    ] {
        let coast = torque(&engine, rpm, 0.0)?;
        assert!(
            (-120.0..=-5.0).contains(&coast),
            "engine braking {coast} at {rpm}"
        );
    }
    Ok(())
}

#[test]
fn engine_torque_rises_with_throttle_and_has_no_jumps() -> Result<(), String> {
    let engine = Engine::v6_2026();
    let mut rpm = engine.idle_rpm();
    let mut previous = torque(&engine, rpm, 1.0)?;
    while rpm < engine.limiter_rpm() - 10.0 {
        rpm += 10.0;
        let mut last = f64::NEG_INFINITY;
        for step in 0..=20 {
            let value = torque(&engine, rpm, f64::from(step) / 20.0)?;
            assert!(value > last, "torque must rise with throttle at {rpm} rpm");
            last = value;
        }
        assert!((last - previous).abs() <= 5.0, "jump at {rpm} rpm");
        previous = last;
    }
    Ok(())
}

#[test]
fn invalid_engine_inputs_are_errors() {
    let engine = Engine::v6_2026();
    for (rpm, throttle) in [
        (f64::NAN, 1.0),
        (-1.0, 1.0),
        (f64::INFINITY, 1.0),
        (9_000.0, -0.01),
        (9_000.0, 1.01),
        (9_000.0, f64::NAN),
    ] {
        assert!(
            engine.torque(rpm, throttle).is_err(),
            "{rpm} rpm, throttle {throttle}"
        );
    }
}

fn top_speed(ratio: f64, rpm: f64) -> f64 {
    rpm_to_rad(rpm) / ratio * WHEEL_RADIUS / KMH
}

#[test]
fn eight_gears_span_a_launch_to_top_speed() {
    assert!((0.34..=0.37).contains(&WHEEL_RADIUS));
    let ratios = Gearbox::eight_speed().ratios();
    let limiter = Engine::v6_2026().limiter_rpm();
    assert_eq!(ratios.len(), 8);
    let first = top_speed(ratios[0], limiter);
    let last = top_speed(ratios[7], limiter);
    assert!(
        (80.0..=130.0).contains(&first),
        "first gear tops out at {first} km/h"
    );
    assert!(
        (330.0..=370.0).contains(&last),
        "eighth gear tops out at {last} km/h"
    );
    let steps: Vec<f64> = ratios.windows(2).map(|pair| pair[0] / pair[1]).collect();
    for step in &steps {
        assert!((1.08..=1.45).contains(step), "gear step {step}");
    }
    for pair in steps.windows(2) {
        assert!(
            pair[1] <= pair[0] + 1e-12,
            "gear steps must get closer: {steps:?}"
        );
    }
}

fn split(diff: &Differential, input: f64, left: f64, right: f64) -> Result<(f64, f64), String> {
    diff.split(input, left, right).map_err(text)
}

#[test]
fn the_differential_never_creates_or_loses_torque() -> Result<(), String> {
    for locking in [0.0, 0.3, 1.0] {
        let diff = Differential::new(locking).map_err(text)?;
        for input in [-900.0, -1.0, 0.0, 250.0, 4_000.0] {
            for (left, right) in [(0.0, 0.0), (100.0, 98.0), (12.0, 160.0), (-3.0, 4.0)] {
                let (a, b) = split(&diff, input, left, right)?;
                assert!((a + b - input).abs() <= 1e-9 * input.abs().max(1.0));
            }
        }
    }
    Ok(())
}

#[test]
fn equal_wheel_speeds_or_an_open_diff_split_torque_evenly() -> Result<(), String> {
    for locking in [0.0, 0.6, 1.0] {
        let diff = Differential::new(locking).map_err(text)?;
        let (a, b) = split(&diff, 1234.5, 80.0, 80.0)?;
        assert_eq!(a.to_bits(), b.to_bits());
    }
    let open = Differential::new(0.0).map_err(text)?;
    for (left, right) in [(10.0, 90.0), (90.0, 10.0), (0.0, 300.0)] {
        let (a, b) = split(&open, 800.0, left, right)?;
        assert_eq!(a.to_bits(), b.to_bits());
    }
    Ok(())
}

#[test]
fn a_locking_diff_gives_the_faster_wheel_less_torque_within_its_limit() -> Result<(), String> {
    let diff = Differential::new(0.5).map_err(text)?;
    for input in [1_000.0, -400.0] {
        let (left, right) = split(&diff, input, 105.0, 100.0)?;
        assert!(left < right, "input {input}: {left} vs {right}");
        assert!(right - left <= 0.5 * f64::abs(input) + 1e-9);
        let (left, right) = split(&diff, input, 100.0, 105.0)?;
        assert!(left > right, "input {input}: {left} vs {right}");
    }
    let tiny = split(&diff, 1_000.0, 100.000_001, 100.0)?;
    assert!(
        (tiny.1 - tiny.0).abs() <= 1.0,
        "a tiny speed difference must not lock the diff"
    );
    Ok(())
}

#[test]
fn invalid_differential_settings_are_errors() -> Result<(), String> {
    for locking in [-0.01, 1.01, f64::NAN] {
        assert!(Differential::new(locking).is_err(), "locking {locking}");
    }
    let diff = Differential::new(0.4).map_err(text)?;
    assert!(diff.split(f64::NAN, 1.0, 1.0).is_err());
    assert!(diff.split(1.0, f64::INFINITY, 1.0).is_err());
    assert!(diff.split(1.0, 1.0, f64::NAN).is_err());
    Ok(())
}

fn brakes_at(pedal: f64, bias: f64) -> Result<[f64; 4], String> {
    Brakes::car_2026().torques(pedal, bias).map_err(text)
}

#[test]
fn brake_torque_follows_the_pedal_and_the_bias_exactly() -> Result<(), String> {
    assert_eq!(brakes_at(0.0, 0.56)?, [0.0; 4]);
    for bias in [0.5, 0.56, 0.62, 0.7] {
        let full = brakes_at(1.0, bias)?;
        let half = brakes_at(0.5, bias)?;
        for (a, b) in full.iter().zip(half.iter()) {
            assert!(relative(*b, a * 0.5) < 1e-12);
        }
        assert_eq!(full[0].to_bits(), full[1].to_bits());
        assert_eq!(full[2].to_bits(), full[3].to_bits());
        let total: f64 = full.iter().sum();
        assert!(relative((full[0] + full[1]) / total, bias) < 1e-12);
        let force = total / WHEEL_RADIUS;
        assert!(
            (30_000.0..=70_000.0).contains(&force),
            "braking force {force}"
        );
    }
    Ok(())
}

#[test]
fn invalid_brake_inputs_are_errors() {
    for (pedal, bias) in [
        (-0.1, 0.56),
        (1.1, 0.56),
        (f64::NAN, 0.56),
        (0.5, 0.44),
        (0.5, 0.76),
        (0.5, f64::NAN),
    ] {
        assert!(
            Brakes::car_2026().torques(pedal, bias).is_err(),
            "{pedal} {bias}"
        );
    }
}

fn ers(energy: f64) -> Result<Ers, String> {
    Ers::new_2026(energy).map_err(text)
}

#[test]
fn the_battery_holds_4_megajoules_and_the_motor_350_kilowatts() -> Result<(), String> {
    let store = ers(1.0e6)?;
    assert_eq!(store.capacity(), 4.0e6);
    assert_eq!(store.energy(), 1.0e6);
    assert!((0.8..=1.0).contains(&store.efficiency()));
    assert_eq!(store.max_power(0.0), 350_000.0);
    assert_eq!(store.max_power(290.0 * KMH), 350_000.0);
    assert_eq!(store.max_power(355.0 * KMH), 0.0);
    assert_eq!(store.max_power(400.0 * KMH), 0.0);
    let mut previous = 350_000.0;
    let mut speed = 290.0;
    while speed < 355.0 {
        speed += 0.5;
        let power = store.max_power(speed * KMH);
        assert!(power < previous, "deployment must taper at {speed} km/h");
        assert!(previous - power < 3_500.0, "deployment must taper smoothly");
        previous = power;
    }
    for energy in [-1.0, 4.0e6 + 1.0, f64::NAN] {
        assert!(Ers::new_2026(energy).is_err(), "energy {energy}");
    }
    Ok(())
}

#[test]
fn deploying_and_harvesting_balance_the_battery_exactly() -> Result<(), String> {
    let mut store = ers(2.0e6)?;
    let efficiency = store.efficiency();
    let delivered = store.step(200_000.0, 50.0, DT).map_err(text)?;
    assert_eq!(delivered, 200_000.0);
    assert!((store.energy() - (2.0e6 - 200_000.0 * DT / efficiency)).abs() < 1e-6);
    let absorbed = store.step(-300_000.0, 50.0, DT).map_err(text)?;
    assert_eq!(absorbed, -300_000.0);
    let expected = 2.0e6 - 200_000.0 * DT / efficiency + 300_000.0 * DT * efficiency;
    assert!((store.energy() - expected).abs() < 1e-6);
    assert!((store.energy() - (2.0e6 - store.deployed() + store.harvested())).abs() < 1e-6);
    Ok(())
}

#[test]
fn the_motor_respects_its_power_and_speed_limits() -> Result<(), String> {
    let mut store = ers(2.0e6)?;
    assert_eq!(store.step(900_000.0, 30.0, DT).map_err(text)?, 350_000.0);
    assert_eq!(store.step(-900_000.0, 30.0, DT).map_err(text)?, -350_000.0);
    assert_eq!(store.step(350_000.0, 360.0 * KMH, DT).map_err(text)?, 0.0);
    assert_eq!(
        store.step(-200_000.0, 360.0 * KMH, DT).map_err(text)?,
        -200_000.0
    );
    Ok(())
}

#[test]
fn an_empty_battery_cannot_deploy_and_a_full_one_cannot_harvest() -> Result<(), String> {
    let mut empty = ers(0.0)?;
    assert_eq!(empty.step(350_000.0, 40.0, DT).map_err(text)?, 0.0);
    assert_eq!(empty.energy(), 0.0);
    let mut full = ers(4.0e6)?;
    assert_eq!(full.step(-350_000.0, 40.0, DT).map_err(text)?, 0.0);
    assert_eq!(full.energy(), 4.0e6);
    let mut nearly = ers(100.0)?;
    let delivered = nearly.step(350_000.0, 40.0, DT).map_err(text)?;
    assert!(delivered > 0.0 && delivered < 350_000.0);
    assert!(nearly.energy().abs() < 1e-9);
    assert!((delivered * DT / nearly.efficiency() - 100.0).abs() < 1e-6);
    Ok(())
}

#[test]
fn invalid_motor_requests_are_errors_and_change_nothing() -> Result<(), String> {
    let mut store = ers(1.0e6)?;
    for (power, speed, dt) in [
        (f64::NAN, 10.0, DT),
        (1.0, f64::NAN, DT),
        (1.0, -1.0, DT),
        (1.0, 10.0, 0.0),
        (1.0, 10.0, -DT),
        (1.0, 10.0, f64::INFINITY),
    ] {
        assert!(
            store.step(power, speed, dt).is_err(),
            "{power} {speed} {dt}"
        );
        assert_eq!(store.energy(), 1.0e6);
    }
    Ok(())
}

fn input(throttle: f64, brake: f64, wheel: f64) -> PowertrainInput {
    PowertrainInput {
        throttle,
        brake,
        shift_up: false,
        shift_down: false,
        left_wheel_speed: wheel,
        right_wheel_speed: wheel,
        car_speed: wheel * WHEEL_RADIUS,
    }
}

fn step(car: &mut Powertrain, request: &PowertrainInput) -> Result<PowertrainOutput, String> {
    car.step(request, DT).map_err(text)
}

fn shift_to(car: &mut Powertrain, gear: u8, wheel: f64) -> Result<(), String> {
    while car.gear() < gear {
        step(
            car,
            &PowertrainInput {
                shift_up: true,
                ..input(0.0, 0.0, wheel)
            },
        )?;
        step(car, &input(0.0, 0.0, wheel))?;
    }
    Ok(())
}

#[test]
fn wheel_torque_delivers_exactly_the_engine_and_motor_power() -> Result<(), String> {
    let engine = Engine::v6_2026();
    let ratios = Gearbox::eight_speed().ratios();
    for (gear, kmh) in [(3_u8, 130.0), (5, 200.0), (8, 300.0)] {
        let mut car = Powertrain::new_2026(2.0e6).map_err(text)?;
        let wheel = kmh * KMH / WHEEL_RADIUS;
        shift_to(&mut car, gear, wheel)?;
        let output = step(&mut car, &input(1.0, 0.0, wheel))?;
        assert_eq!(output.gear, gear);
        let rpm = wheel * ratios[usize::from(gear - 1)] * 60.0 / (2.0 * PI);
        assert!(relative(output.engine_rpm, rpm) < 1e-12);
        let engine_power = torque(&engine, rpm, 1.0)? * rpm_to_rad(rpm);
        assert!(output.ers_power > 0.0, "full throttle deploys the motor");
        let wheel_power = (output.drive_torque[0] + output.drive_torque[1]) * wheel;
        assert!(relative(wheel_power, engine_power + output.ers_power) < 1e-9);
        assert_eq!(
            output.drive_torque[0].to_bits(),
            output.drive_torque[1].to_bits()
        );
        assert_eq!(output.brake_torque, [0.0; 4]);
    }
    Ok(())
}

#[test]
fn launching_from_standstill_pushes_without_dividing_by_zero() -> Result<(), String> {
    let mut car = Powertrain::new_2026(2.0e6).map_err(text)?;
    let output = step(&mut car, &input(1.0, 0.0, 0.0))?;
    assert_eq!(output.gear, 1);
    assert!(output.engine_rpm >= Engine::v6_2026().idle_rpm());
    let total = output.drive_torque[0] + output.drive_torque[1];
    assert!(total.is_finite() && total > 0.0);
    assert!(output.ers_power.is_finite());
    Ok(())
}

#[test]
fn shifting_is_one_gear_per_press_and_stays_between_first_and_eighth() -> Result<(), String> {
    let mut car = Powertrain::new_2026(2.0e6).map_err(text)?;
    let wheel = 300.0 * KMH / WHEEL_RADIUS;
    let held = PowertrainInput {
        shift_up: true,
        ..input(0.0, 0.0, wheel)
    };
    for _ in 0..10 {
        step(&mut car, &held)?;
    }
    assert_eq!(car.gear(), 2);
    shift_to(&mut car, 8, wheel)?;
    step(&mut car, &input(0.0, 0.0, wheel))?;
    step(&mut car, &held)?;
    assert_eq!(car.gear(), 8);
    let mut slow = Powertrain::new_2026(2.0e6).map_err(text)?;
    let down = PowertrainInput {
        shift_down: true,
        ..input(0.0, 0.0, 0.0)
    };
    step(&mut slow, &down)?;
    assert_eq!(slow.gear(), 1);
    Ok(())
}

#[test]
fn a_downshift_that_would_over_rev_the_engine_is_refused() -> Result<(), String> {
    let engine = Engine::v6_2026();
    let ratios = Gearbox::eight_speed().ratios();
    let wheel = rpm_to_rad(engine.limiter_rpm() * 0.95) / ratios[5];
    let mut car = Powertrain::new_2026(2.0e6).map_err(text)?;
    shift_to(&mut car, 7, wheel)?;
    let down = PowertrainInput {
        shift_down: true,
        ..input(0.0, 0.0, wheel)
    };
    step(&mut car, &down)?;
    step(&mut car, &input(0.0, 0.0, wheel))?;
    assert_eq!(car.gear(), 6, "95% of the limit in sixth is allowed");
    step(&mut car, &down)?;
    let output = step(&mut car, &input(0.0, 0.0, wheel))?;
    assert_eq!(car.gear(), 6, "fifth would pass the limiter");
    assert!(output.engine_rpm <= engine.limiter_rpm());
    Ok(())
}

#[test]
fn braking_with_a_full_battery_uses_only_the_friction_brakes() -> Result<(), String> {
    let mut car = Powertrain::new_2026(4.0e6).map_err(text)?;
    car.set_brake_bias(0.57).map_err(text)?;
    let wheel = 250.0 * KMH / WHEEL_RADIUS;
    shift_to(&mut car, 6, wheel)?;
    let output = step(&mut car, &input(0.0, 1.0, wheel))?;
    assert_eq!(output.ers_power, 0.0);
    assert_eq!(output.brake_torque, brakes_at(1.0, 0.57)?);
    assert_eq!(output.battery_energy, 4.0e6);
    Ok(())
}

#[test]
fn regenerative_braking_blends_with_the_rear_brakes() -> Result<(), String> {
    let mut car = Powertrain::new_2026(1.0e6).map_err(text)?;
    car.set_brake_bias(0.57).map_err(text)?;
    let wheel = 200.0 * KMH / WHEEL_RADIUS;
    shift_to(&mut car, 5, wheel)?;
    let target = brakes_at(0.6, 0.57)?;
    let output = step(&mut car, &input(0.0, 0.6, wheel))?;
    assert!(output.ers_power < 0.0, "braking must harvest");
    assert_eq!(output.brake_torque[0], target[0]);
    assert_eq!(output.brake_torque[1], target[1]);
    assert!(output.brake_torque[2] < target[2]);
    let regen = -output.ers_power / wheel;
    let rear = output.brake_torque[2] + output.brake_torque[3] + regen;
    assert!(relative(rear, target[2] + target[3]) < 1e-9);
    assert!(output.battery_energy > 1.0e6);
    Ok(())
}

#[test]
fn the_battery_balances_over_ten_thousand_mixed_steps() -> Result<(), String> {
    let mut car = Powertrain::new_2026(2.0e6).map_err(text)?;
    let efficiency = Ers::new_2026(0.0).map_err(text)?.efficiency();
    let mut expected = 2.0e6;
    let mut wheel: f64 = 60.0;
    let mut energy = 0.0;
    for tick in 0..10_000_u32 {
        let phase = tick % 1000;
        let throttle = if phase < 600 { 1.0 } else { 0.0 };
        let brake = if phase >= 700 { 0.8 } else { 0.0 };
        let request = PowertrainInput {
            shift_up: phase % 150 == 0 && phase < 600,
            shift_down: phase % 60 == 0 && phase >= 700,
            ..input(throttle, brake, wheel)
        };
        let output = step(&mut car, &request)?;
        expected -= if output.ers_power > 0.0 {
            output.ers_power * DT / efficiency
        } else {
            output.ers_power * DT * efficiency
        };
        assert!((0.0..=4.0e6).contains(&output.battery_energy));
        energy = output.battery_energy;
        wheel = (wheel + if throttle > 0.0 { 0.3 } else { -0.5 }).clamp(20.0, 250.0);
    }
    assert!((energy - expected).abs() < 1e-3, "{energy} vs {expected}");
    Ok(())
}

#[test]
fn invalid_powertrain_inputs_are_errors_and_change_nothing() -> Result<(), String> {
    let mut car = Powertrain::new_2026(2.0e6).map_err(text)?;
    let mut twin = Powertrain::new_2026(2.0e6).map_err(text)?;
    let wheel = 100.0;
    shift_to(&mut car, 3, wheel)?;
    shift_to(&mut twin, 3, wheel)?;
    let bad = [
        input(1.5, 0.0, wheel),
        input(f64::NAN, 0.0, wheel),
        input(0.0, -0.2, wheel),
        input(0.0, 0.0, f64::NAN),
        PowertrainInput {
            car_speed: -1.0,
            ..input(0.0, 0.0, wheel)
        },
        PowertrainInput {
            shift_up: true,
            right_wheel_speed: f64::INFINITY,
            ..input(0.0, 0.0, wheel)
        },
    ];
    for request in &bad {
        assert!(car.step(request, DT).is_err());
        assert_eq!(car.gear(), 3);
    }
    assert!(car.step(&input(0.5, 0.0, wheel), 0.0).is_err());
    assert!(car.step(&input(0.5, 0.0, wheel), f64::NAN).is_err());
    let after = step(&mut car, &input(0.7, 0.0, wheel))?;
    let clean = step(&mut twin, &input(0.7, 0.0, wheel))?;
    assert_eq!(
        after.battery_energy.to_bits(),
        clean.battery_energy.to_bits()
    );
    assert_eq!(after.drive_torque, clean.drive_torque);
    for bias in [0.44, 0.76, f64::NAN] {
        assert!(car.set_brake_bias(bias).is_err());
    }
    Ok(())
}

#[test]
fn identical_runs_give_bit_identical_outputs() -> Result<(), String> {
    let run = || -> Result<Vec<u64>, String> {
        let mut car = Powertrain::new_2026(3.0e6).map_err(text)?;
        let mut bits = Vec::new();
        for tick in 0..3000_u32 {
            let x = f64::from(tick);
            let request = PowertrainInput {
                shift_up: tick % 400 == 0,
                shift_down: tick % 700 == 0,
                left_wheel_speed: 30.0 + (x * 0.031) % 150.0,
                ..input(
                    (x * 0.0123) % 1.0,
                    if tick % 5 == 0 { 0.3 } else { 0.0 },
                    31.0 + (x * 0.029) % 150.0,
                )
            };
            let output = step(&mut car, &request)?;
            bits.extend(output.drive_torque.iter().map(|value| value.to_bits()));
            bits.extend(output.brake_torque.iter().map(|value| value.to_bits()));
            bits.push(output.engine_rpm.to_bits());
            bits.push(output.battery_energy.to_bits());
        }
        Ok(bits)
    };
    assert_eq!(run()?, run()?);
    Ok(())
}
