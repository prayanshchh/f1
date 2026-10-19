use tyre::{Tyre, TyreForces, magic_formula};

fn forces(tyre: &Tyre, load: f64, slip_ratio: f64, slip_angle: f64) -> Result<TyreForces, String> {
    tyre.forces(load, slip_ratio, slip_angle)
        .map_err(|error| error.to_string())
}

fn reference_formula(x: f64, b: f64, c: f64, d: f64, e: f64) -> f64 {
    let bx = b * x;
    d * (c * (bx - e * (bx - bx.atan())).atan()).sin()
}

fn degrees(value: f64) -> f64 {
    value.to_radians()
}

struct Peak {
    at: f64,
    force: f64,
}

fn longitudinal_peak(tyre: &Tyre, load: f64) -> Result<Peak, String> {
    let mut best = Peak {
        at: 0.0,
        force: 0.0,
    };
    for step in 0..=2000 {
        let slip = f64::from(step) * 0.0005;
        let force = forces(tyre, load, slip, 0.0)?.longitudinal;
        if force > best.force {
            best = Peak { at: slip, force };
        }
    }
    Ok(best)
}

fn lateral_peak(tyre: &Tyre, load: f64) -> Result<Peak, String> {
    let mut best = Peak {
        at: 0.0,
        force: 0.0,
    };
    for step in 0..=2500 {
        let angle = f64::from(step) * 0.0002;
        let force = -forces(tyre, load, 0.0, angle)?.lateral;
        if force > best.force {
            best = Peak { at: angle, force };
        }
    }
    Ok(best)
}

fn close(actual: f64, expected: f64, tolerance: f64) -> bool {
    (actual - expected).abs() <= tolerance * expected.abs().max(1.0)
}

#[test]
fn magic_formula_matches_the_pacejka_equation() {
    let cases = [
        (0.1, 10.0, 1.9, 1.0, 0.97),
        (-0.05, 12.5, 1.65, 3200.0, -0.4),
        (0.3, 8.0, 1.3, 4100.0, 0.2),
        (2.5, 0.7, 2.1, 1.0, 0.99),
        (1e-7, 11.0, 1.5, 2000.0, 0.5),
        (-0.8, 9.0, 1.45, 1500.0, -1.5),
    ];
    for (x, b, c, d, e) in cases {
        let actual = magic_formula(x, b, c, d, e);
        let expected = reference_formula(x, b, c, d, e);
        assert!(
            close(actual, expected, 1e-12),
            "x={x} b={b} c={c} d={d} e={e}: {actual} != {expected}"
        );
    }
}

#[test]
fn magic_formula_is_zero_at_zero_and_odd() {
    for x in [0.0, 0.01, 0.07, 0.2, 1.0, 30.0] {
        let positive = magic_formula(x, 10.0, 1.9, 1.0, 0.97);
        let negative = magic_formula(-x, 10.0, 1.9, 1.0, 0.97);
        assert_eq!(positive.to_bits(), (-negative).to_bits(), "x={x}");
    }
    assert_eq!(magic_formula(0.0, 10.0, 1.9, 1.0, 0.97), 0.0);
}

#[test]
fn magic_formula_peaks_at_d_where_the_shape_says() {
    let (b, c, d) = (10.0, 1.9, 4200.0);
    let at = (std::f64::consts::FRAC_PI_2 / c).tan() / b;
    assert!(close(magic_formula(at, b, c, d, 0.0), d, 1e-12));
    assert!(magic_formula(at * 0.9, b, c, d, 0.0) < d);
    assert!(magic_formula(at * 1.1, b, c, d, 0.0) < d);
    let far = magic_formula(1e9, b, c, d, 0.0);
    let asymptote = d * (c * std::f64::consts::FRAC_PI_2).sin();
    assert!(close(far, asymptote, 1e-6), "{far} vs {asymptote}");
}

#[test]
fn the_slick_has_a_plausible_nominal_load() {
    let load = Tyre::slick().nominal_load();
    assert!((1500.0..=6000.0).contains(&load), "nominal load {load}");
}

#[test]
fn no_slip_gives_exactly_no_force() -> Result<(), String> {
    let tyre = Tyre::slick();
    for load in [100.0, tyre.nominal_load(), 3.0 * tyre.nominal_load()] {
        let result = forces(&tyre, load, 0.0, 0.0)?;
        assert_eq!(result.longitudinal, 0.0);
        assert_eq!(result.lateral, 0.0);
    }
    Ok(())
}

#[test]
fn pure_slip_produces_force_only_on_its_own_axis() -> Result<(), String> {
    let tyre = Tyre::slick();
    let load = tyre.nominal_load();
    for slip in [-1.0, -0.2, -0.05, 0.03, 0.1, 0.5, 2.0] {
        assert_eq!(forces(&tyre, load, slip, 0.0)?.lateral, 0.0, "slip {slip}");
    }
    for angle in [-1.2, -0.3, -0.05, 0.01, 0.1, 0.6] {
        assert_eq!(
            forces(&tyre, load, 0.0, angle)?.longitudinal,
            0.0,
            "angle {angle}"
        );
    }
    Ok(())
}

#[test]
fn driving_slip_pushes_forward_and_braking_slip_pushes_back() -> Result<(), String> {
    let tyre = Tyre::slick();
    let load = tyre.nominal_load();
    for slip in [0.001, 0.05, 0.1, 0.4, 1.0, 3.0] {
        assert!(forces(&tyre, load, slip, 0.0)?.longitudinal > 0.0);
        assert!(forces(&tyre, load, -slip.min(1.0), 0.0)?.longitudinal < 0.0);
    }
    Ok(())
}

#[test]
fn positive_slip_angle_gives_a_negative_lateral_force() -> Result<(), String> {
    let tyre = Tyre::slick();
    let load = tyre.nominal_load();
    for angle in [0.0005, 0.02, 0.1, 0.3, 1.0] {
        assert!(
            forces(&tyre, load, 0.0, angle)?.lateral < 0.0,
            "angle {angle}"
        );
        assert!(
            forces(&tyre, load, 0.0, -angle)?.lateral > 0.0,
            "angle {angle}"
        );
    }
    Ok(())
}

#[test]
fn pure_curves_are_odd() -> Result<(), String> {
    let tyre = Tyre::slick();
    let load = tyre.nominal_load();
    for step in 1..=100 {
        let slip = f64::from(step) * 0.01;
        let ahead = forces(&tyre, load, slip, 0.0)?.longitudinal;
        let behind = forces(&tyre, load, -slip, 0.0)?.longitudinal;
        assert!(
            close(ahead, -behind, 1e-9),
            "slip {slip}: {ahead} vs {behind}"
        );
        let angle = f64::from(step) * 0.005;
        let left = forces(&tyre, load, 0.0, angle)?.lateral;
        let right = forces(&tyre, load, 0.0, -angle)?.lateral;
        assert!(
            close(left, -right, 1e-9),
            "angle {angle}: {left} vs {right}"
        );
    }
    Ok(())
}

#[test]
fn longitudinal_curve_peaks_like_a_racing_slick() -> Result<(), String> {
    let tyre = Tyre::slick();
    let load = tyre.nominal_load();
    let peak = longitudinal_peak(&tyre, load)?;
    assert!(
        (0.05..=0.2).contains(&peak.at),
        "peak slip ratio {}",
        peak.at
    );
    let friction = peak.force / load;
    assert!((1.3..=2.2).contains(&friction), "peak friction {friction}");
    let spinning = forces(&tyre, load, 1.0, 0.0)?.longitudinal;
    assert!(
        spinning < peak.force * 0.98,
        "the curve must fall after the peak"
    );
    assert!(
        spinning > peak.force * 0.6,
        "wheelspin keeps most grip: {spinning}"
    );
    let locked = forces(&tyre, load, -1.0, 0.0)?.longitudinal;
    assert!(locked < -peak.force * 0.6 && locked > -peak.force * 0.98);
    Ok(())
}

#[test]
fn lateral_curve_peaks_like_a_racing_slick() -> Result<(), String> {
    let tyre = Tyre::slick();
    let load = tyre.nominal_load();
    let peak = lateral_peak(&tyre, load)?;
    assert!(
        (degrees(2.0)..=degrees(10.0)).contains(&peak.at),
        "peak slip angle {} degrees",
        peak.at.to_degrees()
    );
    let friction = peak.force / load;
    assert!((1.3..=2.2).contains(&friction), "peak friction {friction}");
    let sliding = -forces(&tyre, load, 0.0, degrees(20.0))?.lateral;
    assert!(sliding < peak.force * 0.98 && sliding > peak.force * 0.6);
    let stiffness = -forces(&tyre, load, 0.0, 1e-4)?.lateral / 1e-4 / load;
    assert!(
        (8.0..=60.0).contains(&stiffness),
        "cornering stiffness {stiffness} per radian per newton"
    );
    Ok(())
}

#[test]
fn curves_rise_smoothly_to_the_peak_without_jumps() -> Result<(), String> {
    let tyre = Tyre::slick();
    let load = tyre.nominal_load();
    let peak = lateral_peak(&tyre, load)?;
    let mut previous = 0.0;
    let mut angle = 0.0;
    while angle < peak.at - 0.0003 {
        angle += 0.0001;
        let force = -forces(&tyre, load, 0.0, angle)?.lateral;
        assert!(
            force > previous,
            "lateral force must rise until the peak at {angle}"
        );
        previous = force;
    }
    let mut last = forces(&tyre, load, -1.0, 0.0)?.longitudinal;
    for step in 1..=40_000 {
        let slip = -1.0 + f64::from(step) * 0.0001;
        let force = forces(&tyre, load, slip, 0.0)?.longitudinal;
        assert!(
            (force - last).abs() < load * 0.01,
            "jump at slip ratio {slip}"
        );
        last = force;
    }
    Ok(())
}

#[test]
fn lifted_or_unloaded_tyres_give_no_force() -> Result<(), String> {
    let tyre = Tyre::slick();
    for load in [0.0, -0.0, -1.0, -5000.0] {
        let result = forces(&tyre, load, 0.15, 0.1)?;
        assert_eq!(result.longitudinal, 0.0, "load {load}");
        assert_eq!(result.lateral, 0.0, "load {load}");
    }
    let tiny = forces(&tyre, 1e-6, 0.15, 0.1)?;
    assert!(tiny.longitudinal.abs() < 1e-4 && tiny.lateral.abs() < 1e-4);
    Ok(())
}

#[test]
fn more_load_gives_more_force_but_less_friction() -> Result<(), String> {
    let tyre = Tyre::slick();
    let nominal = tyre.nominal_load();
    let factors = [0.25, 0.5, 1.0, 1.5, 2.0, 3.0];
    let mut longitudinal = Vec::new();
    let mut lateral = Vec::new();
    for factor in factors {
        let load = nominal * factor;
        longitudinal.push((load, longitudinal_peak(&tyre, load)?.force));
        lateral.push((load, lateral_peak(&tyre, load)?.force));
    }
    for curve in [&longitudinal, &lateral] {
        for pair in curve.windows(2) {
            let (low_load, low_force) = pair[0];
            let (high_load, high_force) = pair[1];
            assert!(high_force > low_force, "peak force must grow with load");
            assert!(
                high_force / high_load < low_force / low_load,
                "peak friction must fall with load"
            );
        }
        let (light_load, light_force) = curve[0];
        let (heavy_load, heavy_force) = curve[curve.len() - 1];
        let ratio = (heavy_force / heavy_load) / (light_force / light_load);
        assert!((0.6..=0.95).contains(&ratio), "friction ratio {ratio}");
    }
    Ok(())
}

#[test]
fn combined_slip_reduces_each_force_and_keeps_signs() -> Result<(), String> {
    let tyre = Tyre::slick();
    let load = tyre.nominal_load();
    for slip in [-0.6, -0.1, -0.03, 0.02, 0.08, 0.3] {
        for angle in [-0.3, -0.08, -0.01, 0.01, 0.06, 0.25] {
            let combined = forces(&tyre, load, slip, angle)?;
            let alone_x = forces(&tyre, load, slip, 0.0)?.longitudinal;
            let alone_y = forces(&tyre, load, 0.0, angle)?.lateral;
            assert!(
                combined.longitudinal.abs() < alone_x.abs(),
                "slip {slip} angle {angle}"
            );
            assert!(
                combined.lateral.abs() < alone_y.abs(),
                "slip {slip} angle {angle}"
            );
            assert_eq!(combined.longitudinal.signum(), slip.signum());
            assert_eq!(combined.lateral.signum(), -angle.signum());
        }
    }
    Ok(())
}

#[test]
fn combined_slip_is_mirror_symmetric() -> Result<(), String> {
    let tyre = Tyre::slick();
    let load = tyre.nominal_load();
    for slip in [-0.5, -0.07, 0.04, 0.2] {
        for angle in [0.02, 0.09, 0.4] {
            let left = forces(&tyre, load, slip, angle)?;
            let right = forces(&tyre, load, slip, -angle)?;
            assert!(close(left.longitudinal, right.longitudinal, 1e-9));
            assert!(close(left.lateral, -right.lateral, 1e-9));
        }
    }
    Ok(())
}

#[test]
fn combined_force_stays_inside_the_friction_limit() -> Result<(), String> {
    let tyre = Tyre::slick();
    for factor in [0.5, 1.0, 2.5] {
        let load = tyre.nominal_load() * factor;
        let limit = longitudinal_peak(&tyre, load)?
            .force
            .max(lateral_peak(&tyre, load)?.force);
        for slip_step in -20..=20 {
            for angle_step in -20..=20 {
                let slip = f64::from(slip_step) * 0.05;
                let angle = f64::from(angle_step) * 0.025;
                let result = forces(&tyre, load, slip, angle)?;
                let total = result.longitudinal.hypot(result.lateral);
                assert!(
                    total <= limit * 1.01,
                    "slip {slip} angle {angle}: {total} > {limit}"
                );
            }
        }
    }
    Ok(())
}

#[test]
fn a_locked_wheel_loses_most_of_its_cornering_force() -> Result<(), String> {
    let tyre = Tyre::slick();
    let load = tyre.nominal_load();
    let rolling = forces(&tyre, load, 0.0, degrees(5.0))?.lateral;
    let locked = forces(&tyre, load, -1.0, degrees(5.0))?.lateral;
    assert!(locked.abs() < rolling.abs() * 0.5, "{locked} vs {rolling}");
    Ok(())
}

#[test]
fn invalid_inputs_are_errors_not_nan() {
    let tyre = Tyre::slick();
    let load = tyre.nominal_load();
    let bad = [
        (f64::NAN, 0.1, 0.1),
        (f64::INFINITY, 0.1, 0.1),
        (load, f64::NAN, 0.1),
        (load, f64::INFINITY, 0.1),
        (load, f64::NEG_INFINITY, 0.1),
        (load, 0.1, f64::NAN),
        (load, 0.1, f64::INFINITY),
        (load, 0.1, std::f64::consts::FRAC_PI_2 + 1e-9),
        (load, 0.1, -std::f64::consts::FRAC_PI_2 - 1e-9),
        (load, -1.0 - 1e-9, 0.0),
    ];
    for (load, slip, angle) in bad {
        assert!(
            forces(&tyre, load, slip, angle).is_err(),
            "load {load} slip {slip} angle {angle} must be rejected"
        );
    }
    for angle in [std::f64::consts::FRAC_PI_2, -std::f64::consts::FRAC_PI_2] {
        assert!(forces(&tyre, load, 0.0, angle).is_ok());
    }
}

#[test]
fn extreme_but_valid_inputs_give_finite_forces() -> Result<(), String> {
    let tyre = Tyre::slick();
    for load in [1e-9, 1.0, 1e5] {
        for slip in [-1.0, 0.0, 50.0, 1e6] {
            for angle in [-std::f64::consts::FRAC_PI_2, -1e-12, 0.0, 1.5] {
                let result = forces(&tyre, load, slip, angle)?;
                assert!(result.longitudinal.is_finite() && result.lateral.is_finite());
            }
        }
    }
    Ok(())
}

#[test]
fn the_same_inputs_give_bit_identical_forces() -> Result<(), String> {
    let first = Tyre::slick();
    let second = Tyre::slick();
    for step in 0..500 {
        let x = f64::from(step);
        let load = 800.0 + x * 13.7;
        let slip = (x * 0.0137) % 1.3 - 0.6;
        let angle = (x * 0.00731) % 0.9 - 0.45;
        let a = forces(&first, load, slip, angle)?;
        let b = forces(&second, load, slip, angle)?;
        assert_eq!(a.longitudinal.to_bits(), b.longitudinal.to_bits());
        assert_eq!(a.lateral.to_bits(), b.lateral.to_bits());
    }
    Ok(())
}
