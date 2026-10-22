use assists::{
    Abs, AbsInput, AssistError, AssistLevel, Pedals, SteeringRack, TractionControl, TractionInput,
    slip_ratio,
};
use std::f64::consts::PI;
use tyre::Tyre;

const DT: f64 = 1.0 / 500.0;
const SUBSTEPS: u32 = 20;
const RADIUS: f64 = 0.36;
const INERTIA: f64 = 1.2;
const MASS: f64 = 400.0;
const LOAD: f64 = 4000.0;

fn text<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

struct Wheel {
    omega: f64,
    speed: f64,
}

fn advance(wheel: &mut Wheel, drive: f64, brake: f64) -> Result<(), String> {
    let h = DT / f64::from(SUBSTEPS);
    for _ in 0..SUBSTEPS {
        let slip = slip_ratio(wheel.omega, RADIUS, wheel.speed).map_err(text)?;
        let force = Tyre::slick()
            .forces(LOAD, slip, 0.0)
            .map_err(text)?
            .longitudinal;
        let held = if wheel.omega > 0.0 { brake } else { 0.0 };
        wheel.omega = (wheel.omega + (drive - held - force * RADIUS) / INERTIA * h).max(0.0);
        wheel.speed += force / MASS * h;
    }
    Ok(())
}

fn traction_input(omega: f64, speed: f64, torque: f64) -> TractionInput {
    TractionInput {
        rear_wheel_speeds: [omega; 2],
        vehicle_speed: speed,
        drive_torque: [torque; 2],
        wheel_radius: RADIUS,
    }
}

fn abs_input(omega: f64, speed: f64, torque: f64) -> AbsInput {
    AbsInput {
        wheel_speeds: [omega; 4],
        vehicle_speed: speed,
        brake_torque: [torque; 4],
        wheel_radius: RADIUS,
    }
}

fn launch(level: AssistLevel) -> Result<(Vec<f64>, f64), String> {
    let mut wheel = Wheel {
        omega: 5.0 / RADIUS,
        speed: 5.0,
    };
    let mut controller = TractionControl::new(level);
    let mut trace = Vec::new();
    for _ in 0..1500 {
        trace.push(slip_ratio(wheel.omega, RADIUS, wheel.speed).map_err(text)?);
        let input = traction_input(wheel.omega, wheel.speed, 4000.0);
        let output = controller.step(&input, DT).map_err(text)?;
        for torque in output.drive_torque {
            assert!((0.0..=4000.0).contains(&torque));
        }
        advance(&mut wheel, output.drive_torque[0], 0.0)?;
    }
    Ok((trace, wheel.speed))
}

fn stop(level: AssistLevel) -> Result<(Vec<f64>, f64), String> {
    let mut wheel = Wheel {
        omega: 80.0 / RADIUS,
        speed: 80.0,
    };
    let mut controller = Abs::new(level);
    let mut trace = Vec::new();
    for tick in 1..=7500 {
        trace.push(slip_ratio(wheel.omega, RADIUS, wheel.speed).map_err(text)?);
        let input = abs_input(wheel.omega, wheel.speed, 5000.0);
        let output = controller.step(&input, DT).map_err(text)?;
        for torque in output.brake_torque {
            assert!((0.0..=5000.0).contains(&torque));
        }
        advance(&mut wheel, 0.0, output.brake_torque[0])?;
        if wheel.speed < 5.0 {
            return Ok((trace, f64::from(tick) * DT));
        }
    }
    Err("braking simulation did not stop within 7500 ticks".to_owned())
}

#[test]
fn the_rack_reaches_full_lock_at_its_rate() -> Result<(), String> {
    let mut rack = SteeringRack::new(3.0).map_err(text)?;
    for tick in 1..=200 {
        let position = rack.step(1.0, DT).map_err(text)?;
        if tick <= 166 {
            assert!((position - f64::from(tick) * 0.006).abs() < 1e-9);
            assert!(position < 1.0);
        } else {
            assert_eq!(position.to_bits(), 1.0_f64.to_bits());
        }
    }
    Ok(())
}

#[test]
fn the_rack_reverses_lock_to_lock_at_the_same_rate() -> Result<(), String> {
    let mut rack = SteeringRack::new(3.0).map_err(text)?;
    for _ in 0..167 {
        rack.step(1.0, DT).map_err(text)?;
    }
    for tick in 1..=334 {
        let previous = rack.position();
        let position = rack.step(-1.0, DT).map_err(text)?;
        assert!(position <= previous);
        if tick < 334 {
            assert!(position > -1.0);
        } else {
            assert_eq!(position.to_bits(), (-1.0_f64).to_bits());
        }
    }
    Ok(())
}

#[test]
fn slow_steering_passes_through_the_rack_unchanged() -> Result<(), String> {
    let mut rack = SteeringRack::new(3.0).map_err(text)?;
    for tick in 1..=1000 {
        let command = 0.5 * libm::sin(PI * f64::from(tick) * DT);
        assert_eq!(
            rack.step(command, DT).map_err(text)?.to_bits(),
            command.to_bits()
        );
    }
    Ok(())
}

#[test]
fn the_rack_rejects_bad_input_and_keeps_its_position() -> Result<(), String> {
    let mut rack = SteeringRack::new(3.0).map_err(text)?;
    for _ in 0..50 {
        rack.step(1.0, DT).map_err(text)?;
    }
    let before = rack.position().to_bits();
    for command in [f64::NAN, 1.0001, -1.5, f64::INFINITY, f64::NEG_INFINITY] {
        assert_eq!(rack.step(command, DT), Err(AssistError::Steer));
        assert_eq!(rack.position().to_bits(), before);
    }
    for dt in [0.0, -DT, f64::NAN, f64::INFINITY] {
        assert_eq!(rack.step(1.0, dt), Err(AssistError::TimeStep));
        assert_eq!(rack.position().to_bits(), before);
    }
    for rate in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        assert_eq!(SteeringRack::new(rate), Err(AssistError::Rate));
    }
    Ok(())
}

#[test]
fn pedals_follow_a_first_order_lag() -> Result<(), String> {
    let mut pedals = Pedals::new(0.03, 0.02).map_err(text)?;
    let expected = 1.0 - libm::exp(-1.0);
    for tick in 1..=15 {
        let previous = pedals.positions();
        let position = pedals.step(1.0, 1.0, DT).map_err(text)?;
        assert!(position.throttle > previous.throttle);
        assert!(position.brake > previous.brake);
        if tick == 10 {
            assert!((position.brake - expected).abs() < 1e-9);
        }
        if tick == 15 {
            assert!((position.throttle - expected).abs() < 1e-9);
        }
    }
    Ok(())
}

#[test]
fn pedals_settle_exactly_on_full_and_on_zero() -> Result<(), String> {
    let mut pedals = Pedals::new(0.03, 0.02).map_err(text)?;
    for target in [1.0_f64, 0.0] {
        for _ in 0..500 {
            pedals.step(target, target, DT).map_err(text)?;
        }
        assert_eq!(pedals.positions().throttle.to_bits(), target.to_bits());
        assert_eq!(pedals.positions().brake.to_bits(), target.to_bits());
    }
    Ok(())
}

#[test]
fn pedals_reject_out_of_range_input_and_keep_state() -> Result<(), String> {
    let mut pedals = Pedals::new(0.03, 0.02).map_err(text)?;
    for _ in 0..5 {
        pedals.step(1.0, 0.5, DT).map_err(text)?;
    }
    let before = pedals;
    for value in [-0.1, 1.1, f64::NAN, f64::INFINITY] {
        assert_eq!(pedals.step(value, 0.5, DT), Err(AssistError::Throttle));
        assert_eq!(pedals, before);
        assert_eq!(pedals.step(1.0, value, DT), Err(AssistError::Brake));
        assert_eq!(pedals, before);
    }
    for dt in [0.0, -DT, f64::NAN, f64::INFINITY] {
        assert_eq!(pedals.step(1.0, 0.5, dt), Err(AssistError::TimeStep));
        assert_eq!(pedals, before);
    }
    for time in [0.0, -0.1, f64::NAN, f64::INFINITY] {
        assert_eq!(Pedals::new(time, 0.02), Err(AssistError::TimeConstant));
        assert_eq!(Pedals::new(0.03, time), Err(AssistError::TimeConstant));
    }
    Ok(())
}

#[test]
fn slip_ratio_matches_the_tyre_convention() -> Result<(), String> {
    for (omega, speed, expected) in [
        (100.0, 30.0, 0.2),
        (30.0 / RADIUS, 30.0, 0.0),
        (10.0, 0.0, 3.6),
    ] {
        assert!((slip_ratio(omega, RADIUS, speed).map_err(text)? - expected).abs() < 1e-12);
    }
    for omega in [0.0, -50.0] {
        assert_eq!(
            slip_ratio(omega, RADIUS, 30.0).map_err(text)?.to_bits(),
            (-1.0_f64).to_bits()
        );
    }
    assert_eq!(
        slip_ratio(f64::NAN, RADIUS, 30.0),
        Err(AssistError::WheelSpeed)
    );
    assert_eq!(slip_ratio(100.0, 0.0, 30.0), Err(AssistError::WheelRadius));
    assert_eq!(
        slip_ratio(100.0, RADIUS, f64::INFINITY),
        Err(AssistError::VehicleSpeed)
    );
    Ok(())
}

#[test]
fn traction_control_holds_rear_slip_in_the_target_band() -> Result<(), String> {
    for (level, target) in [(AssistLevel::Low, 0.12), (AssistLevel::High, 0.06)] {
        let (trace, _) = launch(level)?;
        for (tick, slip) in trace.iter().enumerate() {
            assert!(*slip <= 0.3, "{level:?} tick {tick}: {slip}");
            if tick >= 50 {
                assert!(
                    (slip - target).abs() <= 0.03,
                    "{level:?} tick {tick}: {slip}"
                );
            }
        }
    }
    Ok(())
}

#[test]
fn traction_control_launches_faster_than_wheelspin() -> Result<(), String> {
    let (off_trace, off) = launch(AssistLevel::Off)?;
    let (_, low) = launch(AssistLevel::Low)?;
    let (_, high) = launch(AssistLevel::High)?;
    assert!(off_trace.iter().any(|slip| *slip > 1.0));
    assert!(
        low > high && high > off,
        "Low {low}, High {high}, Off {off}"
    );
    Ok(())
}

#[test]
fn traction_control_cuts_only_the_spinning_wheel() -> Result<(), String> {
    let mut controller = TractionControl::new(AssistLevel::High);
    let mut input = traction_input(120.0, 30.0, 3000.0);
    input.rear_wheel_speeds[1] = 30.0 / RADIUS;
    for _ in 0..10 {
        let output = controller.step(&input, DT).map_err(text)?;
        assert!(output.drive_torque[0] < 3000.0);
        assert_eq!(output.drive_torque[1].to_bits(), 3000.0_f64.to_bits());
        assert!(output.active);
    }
    Ok(())
}

#[test]
fn traction_control_leaves_engine_braking_alone() -> Result<(), String> {
    let mut controller = TractionControl::new(AssistLevel::High);
    let mut input = traction_input(200.0, 30.0, -500.0);
    input.drive_torque[1] = -0.0;
    for _ in 0..10 {
        let output = controller.step(&input, DT).map_err(text)?;
        assert_eq!(
            output.drive_torque.map(f64::to_bits),
            input.drive_torque.map(f64::to_bits)
        );
        assert!(!output.active);
    }
    Ok(())
}

#[test]
fn off_and_level_changes_reset_traction_control() -> Result<(), String> {
    let spinning = traction_input(200.0, 30.0, 3000.0);
    let gripping = traction_input(30.0 / RADIUS, 30.0, 3000.0);
    let mut controller = TractionControl::new(AssistLevel::Off);
    let output = controller.step(&spinning, DT).map_err(text)?;
    assert_eq!(
        output.drive_torque.map(f64::to_bits),
        spinning.drive_torque.map(f64::to_bits)
    );
    assert!(!output.active);
    for level in [
        AssistLevel::Low,
        AssistLevel::High,
        AssistLevel::Off,
        AssistLevel::High,
    ] {
        controller.set_level(AssistLevel::High);
        for _ in 0..20 {
            controller.step(&spinning, DT).map_err(text)?;
        }
        controller.set_level(level);
        assert_eq!(controller.level(), level);
        let actual = controller.step(&gripping, DT).map_err(text)?;
        let expected = TractionControl::new(level)
            .step(&gripping, DT)
            .map_err(text)?;
        assert_eq!(
            actual.drive_torque.map(f64::to_bits),
            expected.drive_torque.map(f64::to_bits)
        );
        assert_eq!(actual.active, expected.active);
        assert_eq!(controller, TractionControl::new(level));
    }
    Ok(())
}

#[test]
fn abs_holds_brake_slip_in_the_target_band() -> Result<(), String> {
    for (level, target) in [(AssistLevel::Low, 0.12), (AssistLevel::High, 0.06)] {
        let (trace, _) = stop(level)?;
        for (tick, slip) in trace.iter().enumerate() {
            assert!(*slip >= -0.3, "{level:?} tick {tick}: {slip}");
            if tick >= 50 {
                assert!(
                    (slip + target).abs() <= 0.03,
                    "{level:?} tick {tick}: {slip}"
                );
            }
        }
    }
    Ok(())
}

#[test]
fn abs_stops_sooner_than_locked_wheels() -> Result<(), String> {
    let (trace, off) = stop(AssistLevel::Off)?;
    let (_, low) = stop(AssistLevel::Low)?;
    let (_, high) = stop(AssistLevel::High)?;
    assert!(
        trace
            .iter()
            .any(|slip| slip.to_bits() == (-1.0_f64).to_bits())
    );
    assert!(low < off && high < off, "Low {low}, High {high}, Off {off}");
    Ok(())
}

#[test]
fn abs_releases_only_the_locking_wheel() -> Result<(), String> {
    let mut controller = Abs::new(AssistLevel::High);
    let mut input = abs_input(30.0 / RADIUS, 30.0, 4000.0);
    input.wheel_speeds[0] = 0.0;
    for _ in 0..10 {
        let output = controller.step(&input, DT).map_err(text)?;
        assert!(output.brake_torque[0] < 4000.0);
        for torque in &output.brake_torque[1..] {
            assert_eq!(torque.to_bits(), 4000.0_f64.to_bits());
        }
        assert!(output.active);
    }
    let gripping = abs_input(30.0 / RADIUS, 30.0, 4000.0);
    for level in [AssistLevel::High, AssistLevel::Low, AssistLevel::Off] {
        controller.set_level(level);
        assert_eq!(controller.level(), level);
        assert_eq!(
            controller.step(&gripping, DT).map_err(text)?,
            Abs::new(level).step(&gripping, DT).map_err(text)?
        );
    }
    Ok(())
}

#[test]
fn abs_lets_the_wheels_stop_at_walking_pace() -> Result<(), String> {
    let mut controller = Abs::new(AssistLevel::High);
    let locking = abs_input(0.0, 30.0, 4000.0);
    for _ in 0..20 {
        controller.step(&locking, DT).map_err(text)?;
    }
    for speed in [1.5, -1.5] {
        let input = abs_input(0.0, speed, 4000.0);
        let output = controller.step(&input, DT).map_err(text)?;
        assert_eq!(
            output.brake_torque.map(f64::to_bits),
            input.brake_torque.map(f64::to_bits)
        );
        assert!(!output.active);
        assert_eq!(controller, Abs::new(AssistLevel::High));
    }
    let output = Abs::new(AssistLevel::Off)
        .step(&locking, DT)
        .map_err(text)?;
    assert_eq!(
        output.brake_torque.map(f64::to_bits),
        locking.brake_torque.map(f64::to_bits)
    );
    assert!(!output.active);
    Ok(())
}

fn invalid_traction_inputs(input: TractionInput) -> Vec<(TractionInput, AssistError)> {
    let mut cases = Vec::new();
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        for index in 0..2 {
            let mut bad = input;
            bad.rear_wheel_speeds[index] = value;
            cases.push((bad, AssistError::WheelSpeed));
            let mut bad = input;
            bad.drive_torque[index] = value;
            cases.push((bad, AssistError::Torque));
        }
        let mut bad = input;
        bad.vehicle_speed = value;
        cases.push((bad, AssistError::VehicleSpeed));
    }
    for radius in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        let mut bad = input;
        bad.wheel_radius = radius;
        cases.push((bad, AssistError::WheelRadius));
    }
    cases
}

fn invalid_abs_inputs(input: AbsInput) -> Vec<(AbsInput, AssistError)> {
    let mut cases = Vec::new();
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        for index in 0..4 {
            let mut bad = input;
            bad.wheel_speeds[index] = value;
            cases.push((bad, AssistError::WheelSpeed));
        }
        let mut bad = input;
        bad.vehicle_speed = value;
        cases.push((bad, AssistError::VehicleSpeed));
    }
    for torque in [-1.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        for index in 0..4 {
            let mut bad = input;
            bad.brake_torque[index] = torque;
            cases.push((bad, AssistError::Torque));
        }
    }
    for radius in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        let mut bad = input;
        bad.wheel_radius = radius;
        cases.push((bad, AssistError::WheelRadius));
    }
    cases
}

#[test]
fn assists_reject_bad_input_and_keep_state() -> Result<(), String> {
    let spinning = traction_input(200.0, 30.0, 3000.0);
    let locking = abs_input(0.0, 30.0, 4000.0);
    for level in [AssistLevel::High, AssistLevel::Off] {
        let mut tc = TractionControl::new(level);
        let mut abs = Abs::new(level);
        for _ in 0..20 {
            tc.step(&spinning, DT).map_err(text)?;
            abs.step(&locking, DT).map_err(text)?;
        }
        let tc_before = tc;
        let abs_before = abs;
        for (input, error) in invalid_traction_inputs(spinning) {
            assert_eq!(tc.step(&input, DT), Err(error));
            assert_eq!(tc, tc_before);
        }
        for (input, error) in invalid_abs_inputs(locking) {
            assert_eq!(abs.step(&input, DT), Err(error));
            assert_eq!(abs, abs_before);
        }
        for dt in [0.0, -DT, f64::NAN, f64::INFINITY] {
            assert_eq!(tc.step(&spinning, dt), Err(AssistError::TimeStep));
            assert_eq!(abs.step(&locking, dt), Err(AssistError::TimeStep));
            assert_eq!(tc, tc_before);
            assert_eq!(abs, abs_before);
        }
    }
    Ok(())
}

fn actuator_trace() -> Result<Vec<[u64; 3]>, String> {
    let mut rack = SteeringRack::new(3.0).map_err(text)?;
    let mut pedals = Pedals::new(0.03, 0.02).map_err(text)?;
    let mut trace = Vec::new();
    for tick in 0..300 {
        let (steer, throttle, brake) = match tick % 100 {
            0..=29 => (1.0, 1.0, 0.0),
            30..=59 => (-1.0, 0.0, 1.0),
            _ => (0.25, 0.5, 0.0),
        };
        let position = rack.step(steer, DT).map_err(text)?;
        let pedals = pedals.step(throttle, brake, DT).map_err(text)?;
        trace.push([
            position.to_bits(),
            pedals.throttle.to_bits(),
            pedals.brake.to_bits(),
        ]);
    }
    Ok(trace)
}

#[test]
fn identical_runs_give_bit_identical_outputs() -> Result<(), String> {
    for (first, second) in [
        (launch(AssistLevel::Low)?, launch(AssistLevel::Low)?),
        (stop(AssistLevel::High)?, stop(AssistLevel::High)?),
    ] {
        assert_eq!(first.1.to_bits(), second.1.to_bits());
        assert_eq!(first.0.len(), second.0.len());
        for (left, right) in first.0.iter().zip(&second.0) {
            assert_eq!(left.to_bits(), right.to_bits());
        }
    }
    assert_eq!(actuator_trace()?, actuator_trace()?);
    Ok(())
}
