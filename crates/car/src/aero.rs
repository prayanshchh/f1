use crate::vector::*;
use ::aero::{Aero, AeroInput};
use chassis::{BUMP_START, CornerState, FRONT_AXLE, REAR_AXLE};
use contracts::{Quat, Vec3};

pub fn forces(
    orientation: &Quat,
    velocity: &Vec3,
    corners: &[CornerState; 4],
    straight_mode: f64,
) -> Result<(Vec3, Vec3), String> {
    let aero = Aero::car_2026();
    let (front, rear) = aero.reference_ride_heights();
    let speed = length(velocity);
    let forces = aero
        .forces(&AeroInput {
            airspeed: speed,
            front_ride_height: (front + BUMP_START
                - (corners[0].compression + corners[1].compression) * 0.5)
                .max(0.0),
            rear_ride_height: (rear + BUMP_START
                - (corners[2].compression + corners[3].compression) * 0.5)
                .max(0.0),
            straight_mode,
        })
        .map_err(|e| e.to_string())?;
    let up = rotate(
        orientation,
        &Vec3 {
            x: 0.0,
            y: 1.0,
            z: 0.0,
        },
    );
    let drag = if speed == 0.0 {
        zero()
    } else {
        scale(velocity, -forces.drag / speed)
    };
    let force = add(
        &drag,
        &scale(&up, -forces.front_downforce - forces.rear_downforce),
    );
    let torque = add(
        &cross(
            &rotate(
                orientation,
                &Vec3 {
                    x: 0.0,
                    y: 0.0,
                    z: FRONT_AXLE,
                },
            ),
            &scale(&up, -forces.front_downforce),
        ),
        &cross(
            &rotate(
                orientation,
                &Vec3 {
                    x: 0.0,
                    y: 0.0,
                    z: -REAR_AXLE,
                },
            ),
            &scale(&up, -forces.rear_downforce),
        ),
    );
    Ok((force, torque))
}
