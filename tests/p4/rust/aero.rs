use aero::{ActiveAero, Aero, AeroForces, AeroInput, AeroMode};

const KMH: f64 = 1.0 / 3.6;

fn at(
    aero: &Aero,
    airspeed: f64,
    front: f64,
    rear: f64,
    straight: f64,
) -> Result<AeroForces, String> {
    aero.forces(&AeroInput {
        airspeed,
        front_ride_height: front,
        rear_ride_height: rear,
        straight_mode: straight,
    })
    .map_err(|error| error.to_string())
}

fn reference(aero: &Aero, airspeed: f64, straight: f64) -> Result<AeroForces, String> {
    let (front, rear) = aero.reference_ride_heights();
    at(aero, airspeed, front, rear, straight)
}

fn downforce(forces: &AeroForces) -> f64 {
    forces.front_downforce + forces.rear_downforce
}

fn front_share(forces: &AeroForces) -> f64 {
    forces.front_downforce / downforce(forces)
}

fn relative(a: f64, b: f64) -> f64 {
    (a - b).abs() / b.abs().max(f64::MIN_POSITIVE)
}

#[test]
fn reference_ride_heights_are_plausible_with_rake() {
    let (front, rear) = Aero::car_2026().reference_ride_heights();
    assert!((0.015..=0.06).contains(&front), "front {front}");
    assert!((0.04..=0.12).contains(&rear), "rear {rear}");
    assert!(rear >= front);
}

#[test]
fn corner_mode_matches_the_target_curve_at_300_kmh() -> Result<(), String> {
    let forces = reference(&Aero::car_2026(), 300.0 * KMH, 0.0)?;
    let total = downforce(&forces);
    assert!((14_000.0..=26_000.0).contains(&total), "downforce {total}");
    assert!(
        (3_500.0..=8_000.0).contains(&forces.drag),
        "drag {}",
        forces.drag
    );
    let efficiency = total / forces.drag;
    assert!(
        (2.5..=5.0).contains(&efficiency),
        "lift to drag {efficiency}"
    );
    let share = front_share(&forces);
    assert!((0.38..=0.5).contains(&share), "front share {share}");
    Ok(())
}

#[test]
fn straight_mode_cuts_drag_and_downforce_but_keeps_the_balance() -> Result<(), String> {
    let aero = Aero::car_2026();
    let corner = reference(&aero, 300.0 * KMH, 0.0)?;
    let straight = reference(&aero, 300.0 * KMH, 1.0)?;
    let drag = straight.drag / corner.drag;
    let grip = downforce(&straight) / downforce(&corner);
    assert!((0.55..=0.85).contains(&drag), "drag ratio {drag}");
    assert!((0.35..=0.8).contains(&grip), "downforce ratio {grip}");
    assert!((front_share(&straight) - front_share(&corner)).abs() <= 0.08);
    Ok(())
}

#[test]
fn forces_grow_exactly_with_the_square_of_airspeed() -> Result<(), String> {
    let aero = Aero::car_2026();
    for straight in [0.0, 0.37, 1.0] {
        for speed in [1.0, 13.7, 40.0, 61.1, 90.0] {
            let slow = reference(&aero, speed, straight)?;
            let fast = reference(&aero, speed * 2.0, straight)?;
            assert!(relative(fast.drag, slow.drag * 4.0) < 1e-12);
            assert!(relative(fast.front_downforce, slow.front_downforce * 4.0) < 1e-12);
            assert!(relative(fast.rear_downforce, slow.rear_downforce * 4.0) < 1e-12);
        }
    }
    Ok(())
}

#[test]
fn still_air_gives_exactly_no_force() -> Result<(), String> {
    let forces = reference(&Aero::car_2026(), 0.0, 0.5)?;
    assert_eq!(forces.drag, 0.0);
    assert_eq!(forces.front_downforce, 0.0);
    assert_eq!(forces.rear_downforce, 0.0);
    Ok(())
}

struct Sweep {
    offsets: Vec<f64>,
    totals: Vec<f64>,
}

fn ride_height_sweep(aero: &Aero) -> Result<Sweep, String> {
    let (front, rear) = aero.reference_ride_heights();
    let lowest = -front.min(rear) + 0.002;
    let mut offsets = Vec::new();
    let mut totals = Vec::new();
    let mut offset = lowest;
    while offset <= 0.08 {
        let forces = at(aero, 250.0 * KMH, front + offset, rear + offset, 0.0)?;
        assert!(forces.front_downforce >= 0.0 && forces.rear_downforce >= 0.0);
        assert!(forces.drag > 0.0);
        offsets.push(offset);
        totals.push(downforce(&forces));
        offset += 0.001;
    }
    Ok(Sweep { offsets, totals })
}

#[test]
fn ground_effect_peaks_near_the_reference_ride_height() -> Result<(), String> {
    let sweep = ride_height_sweep(&Aero::car_2026())?;
    let best = sweep.totals.iter().copied().fold(0.0, f64::max);
    let peak = sweep
        .totals
        .iter()
        .position(|value| *value == best)
        .unwrap_or(0);
    assert!(
        peak > 0 && peak < sweep.totals.len() - 1,
        "the peak must be inside the range"
    );
    let at_reference = sweep
        .offsets
        .iter()
        .position(|offset| offset.abs() < 0.0005)
        .and_then(|index| sweep.totals.get(index).copied())
        .unwrap_or(0.0);
    assert!(
        at_reference >= best * 0.9,
        "reference {at_reference} vs best {best}"
    );
    let bottomed = sweep.totals.first().copied().unwrap_or(best);
    assert!(bottomed <= best * 0.9, "a nearly bottomed floor must stall");
    let raised = sweep.totals.last().copied().unwrap_or(best);
    assert!(
        raised <= best * 0.85,
        "a raised floor must lose ground effect"
    );
    Ok(())
}

#[test]
fn ride_height_changes_never_make_downforce_jump() -> Result<(), String> {
    let sweep = ride_height_sweep(&Aero::car_2026())?;
    let best = sweep.totals.iter().copied().fold(0.0, f64::max);
    for pair in sweep.totals.windows(2) {
        assert!(
            (pair[1] - pair[0]).abs() <= best * 0.04,
            "{} -> {}",
            pair[0],
            pair[1]
        );
    }
    Ok(())
}

#[test]
fn more_rake_moves_the_balance_forward() -> Result<(), String> {
    let aero = Aero::car_2026();
    let (front, rear) = aero.reference_ride_heights();
    let mut previous = 0.0;
    for step in 0..=30 {
        let forces = at(
            &aero,
            200.0 * KMH,
            front,
            rear + f64::from(step) * 0.001,
            0.0,
        )?;
        let share = front_share(&forces);
        assert!(
            share > previous,
            "front share must rise with rake at step {step}"
        );
        previous = share;
    }
    Ok(())
}

#[test]
fn partial_straight_mode_blends_monotonically_between_the_modes() -> Result<(), String> {
    let aero = Aero::car_2026();
    let mut previous = reference(&aero, 280.0 * KMH, 0.0)?;
    for step in 1..=100 {
        let current = reference(&aero, 280.0 * KMH, f64::from(step) / 100.0)?;
        assert!(current.drag < previous.drag, "drag at blend {step}%");
        assert!(
            downforce(&current) < downforce(&previous),
            "downforce at blend {step}%"
        );
        previous = current;
    }
    Ok(())
}

#[test]
fn invalid_aero_inputs_are_errors() {
    let aero = Aero::car_2026();
    let (front, rear) = aero.reference_ride_heights();
    let bad = [
        (f64::NAN, front, rear, 0.0),
        (f64::INFINITY, front, rear, 0.0),
        (-1.0, front, rear, 0.0),
        (50.0, f64::NAN, rear, 0.0),
        (50.0, -0.001, rear, 0.0),
        (50.0, front, f64::INFINITY, 0.0),
        (50.0, front, -0.001, 0.0),
        (50.0, front, rear, -0.01),
        (50.0, front, rear, 1.01),
        (50.0, front, rear, f64::NAN),
    ];
    for (speed, f, r, s) in bad {
        assert!(
            at(&aero, speed, f, r, s).is_err(),
            "{speed} {f} {r} {s} must be rejected"
        );
    }
    assert!(
        at(&aero, 50.0, 0.0, 0.0, 0.0).is_ok(),
        "a floor on the ground is valid"
    );
}

const DT: f64 = 1.0 / 500.0;

fn steps_until(active: &mut ActiveAero, target: f64) -> Result<usize, String> {
    for step in 1..=5000 {
        let before = active.straight_mode();
        active.step(DT).map_err(|error| error.to_string())?;
        let after = active.straight_mode();
        assert!(
            (after - before).abs() <= DT / 0.2 + 1e-12,
            "the wings must move gradually"
        );
        if after == target {
            return Ok(step);
        }
    }
    Err(format!("never reached {target}"))
}

#[test]
fn active_aero_starts_in_corner_mode() -> Result<(), String> {
    let mut active = ActiveAero::new();
    assert_eq!(active.mode(), AeroMode::Corner);
    assert_eq!(active.straight_mode(), 0.0);
    for _ in 0..100 {
        active.step(DT).map_err(|error| error.to_string())?;
    }
    assert_eq!(active.straight_mode(), 0.0);
    Ok(())
}

#[test]
fn opening_the_wings_takes_a_fraction_of_a_second() -> Result<(), String> {
    let mut active = ActiveAero::new();
    active.request(AeroMode::Straight);
    assert_eq!(active.mode(), AeroMode::Straight);
    let steps = steps_until(&mut active, 1.0)?;
    let seconds = steps as f64 * DT;
    assert!((0.2..=0.6).contains(&seconds), "opening took {seconds} s");
    for _ in 0..100 {
        active.step(DT).map_err(|error| error.to_string())?;
        assert_eq!(active.straight_mode(), 1.0);
    }
    active.request(AeroMode::Corner);
    let closing = steps_until(&mut active, 0.0)? as f64 * DT;
    assert!(closing <= seconds + 2.0 * DT, "closing took {closing} s");
    Ok(())
}

#[test]
fn reversing_mid_transition_turns_back_without_a_jump() -> Result<(), String> {
    let mut active = ActiveAero::new();
    active.request(AeroMode::Straight);
    for _ in 0..40 {
        active.step(DT).map_err(|error| error.to_string())?;
    }
    let middle = active.straight_mode();
    assert!(middle > 0.0 && middle < 1.0);
    active.request(AeroMode::Corner);
    active.step(DT).map_err(|error| error.to_string())?;
    assert!(active.straight_mode() < middle);
    assert!(middle - active.straight_mode() <= DT / 0.2 + 1e-12);
    steps_until(&mut active, 0.0)?;
    Ok(())
}

#[test]
fn repeating_a_request_does_not_restart_the_transition() -> Result<(), String> {
    let mut active = ActiveAero::new();
    active.request(AeroMode::Straight);
    for _ in 0..30 {
        active.step(DT).map_err(|error| error.to_string())?;
    }
    let before = active.straight_mode();
    active.request(AeroMode::Straight);
    assert_eq!(active.straight_mode(), before);
    active.step(DT).map_err(|error| error.to_string())?;
    assert!(active.straight_mode() > before);
    Ok(())
}

#[test]
fn a_long_step_lands_on_the_target_without_overshooting() -> Result<(), String> {
    let mut active = ActiveAero::new();
    active.request(AeroMode::Straight);
    active.step(5.0).map_err(|error| error.to_string())?;
    assert_eq!(active.straight_mode(), 1.0);
    active.request(AeroMode::Corner);
    active.step(5.0).map_err(|error| error.to_string())?;
    assert_eq!(active.straight_mode(), 0.0);
    Ok(())
}

#[test]
fn invalid_time_steps_are_errors_and_change_nothing() {
    let mut active = ActiveAero::new();
    active.request(AeroMode::Straight);
    for dt in [0.0, -DT, f64::NAN, f64::INFINITY] {
        assert!(active.step(dt).is_err(), "dt {dt}");
        assert_eq!(active.straight_mode(), 0.0);
    }
}

#[test]
fn the_same_inputs_give_bit_identical_forces() -> Result<(), String> {
    let first = Aero::car_2026();
    let second = Aero::car_2026();
    for step in 0..400 {
        let x = f64::from(step);
        let a = at(
            &first,
            x * 0.23,
            0.003 + (x * 0.00037) % 0.1,
            0.01 + (x * 0.00041) % 0.1,
            (x * 0.0031) % 1.0,
        )?;
        let b = at(
            &second,
            x * 0.23,
            0.003 + (x * 0.00037) % 0.1,
            0.01 + (x * 0.00041) % 0.1,
            (x * 0.0031) % 1.0,
        )?;
        assert_eq!(a.drag.to_bits(), b.drag.to_bits());
        assert_eq!(a.front_downforce.to_bits(), b.front_downforce.to_bits());
        assert_eq!(a.rear_downforce.to_bits(), b.rear_downforce.to_bits());
    }
    Ok(())
}
