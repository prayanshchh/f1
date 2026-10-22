use crate::{DT, Ground, WHEEL_RADIUS, WheelReport, vector::*};
use contracts::Vec3;
use tyre::Tyre;

const TYRE: Tyre = Tyre::slick();
const V_SLIP_MIN: f64 = 4.0;
const ROLLING_RESISTANCE: f64 = 0.012;

pub struct WheelInput {
    pub heading: Vec3,
    pub velocity: Vec3,
    pub ground: Ground,
    pub load: f64,
    pub spin: f64,
    pub drive: f64,
    pub brake: f64,
    pub inertia: f64,
}

pub fn step(input: WheelInput) -> Result<(Vec3, WheelReport), String> {
    let [x, y, z] = input.ground.normal;
    let n = Vec3 { x, y, z };
    let ex = normalize(&sub(&input.heading, &scale(&n, dot(&input.heading, &n))));
    let ey = cross(&n, &ex);
    let vx = dot(&input.velocity, &ex);
    let vy = dot(&input.velocity, &ey);
    let den = vx.abs().max(V_SLIP_MIN);
    let angle = libm::atan2(vy, den);
    let slip = |spin: f64| ((spin * WHEEL_RADIUS - vx) / den).clamp(-1.0, 10.0);
    let ratio = slip(input.spin);
    let forces = |k| TYRE.forces(input.load, k, angle).map_err(|e| e.to_string());
    let f = forces(ratio)?;
    let slope = ((forces(ratio + 1e-4)?.longitudinal - f.longitudinal) / 1e-4).max(0.0)
        * WHEEL_RADIUS
        / den;
    let inertia = input.inertia + DT * WHEEL_RADIUS * slope;
    let predicted = input.spin + DT * (input.drive - WHEEL_RADIUS * f.longitudinal) / inertia;
    let brake = DT * input.brake / inertia;
    let spin = if predicted.abs() <= brake {
        0.0
    } else {
        predicted - predicted.signum() * brake
    };
    let ratio = slip(spin);
    let f = forces(ratio)?;
    let longitudinal = if input.drive <= 0.0 && input.brake == 0.0 {
        f.longitudinal.min(0.0)
    } else {
        f.longitudinal
    };
    let rolling = ROLLING_RESISTANCE * input.load * (vx / 0.5).clamp(-1.0, 1.0);
    Ok((
        add(&scale(&ex, longitudinal - rolling), &scale(&ey, f.lateral)),
        WheelReport {
            spin,
            slip_ratio: ratio,
            slip_angle: angle,
            load: input.load,
        },
    ))
}
