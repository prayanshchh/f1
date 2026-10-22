use contracts::{Quat, Vec3};

pub fn zero() -> Vec3 {
    Vec3 {
        x: 0.0,
        y: 0.0,
        z: 0.0,
    }
}
pub fn add(a: &Vec3, b: &Vec3) -> Vec3 {
    Vec3 {
        x: a.x + b.x,
        y: a.y + b.y,
        z: a.z + b.z,
    }
}
pub fn scale(a: &Vec3, s: f64) -> Vec3 {
    Vec3 {
        x: a.x * s,
        y: a.y * s,
        z: a.z * s,
    }
}
pub fn sub(a: &Vec3, b: &Vec3) -> Vec3 {
    add(a, &scale(b, -1.0))
}
pub fn dot(a: &Vec3, b: &Vec3) -> f64 {
    a.x * b.x + a.y * b.y + a.z * b.z
}
pub fn cross(a: &Vec3, b: &Vec3) -> Vec3 {
    Vec3 {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    }
}
pub fn length(a: &Vec3) -> f64 {
    libm::sqrt(dot(a, a))
}
pub fn normalize(a: &Vec3) -> Vec3 {
    scale(a, 1.0 / length(a))
}
pub fn rotate(q: &Quat, v: &Vec3) -> Vec3 {
    let axis = Vec3 {
        x: q.x,
        y: q.y,
        z: q.z,
    };
    let t = scale(&cross(&axis, v), 2.0);
    add(&add(v, &scale(&t, q.w)), &cross(&axis, &t))
}
pub fn anchors() -> [Vec3; 4] {
    use chassis::{FRONT_AXLE, HALF_TRACK, REAR_AXLE};
    [
        (HALF_TRACK, FRONT_AXLE),
        (-HALF_TRACK, FRONT_AXLE),
        (HALF_TRACK, -REAR_AXLE),
        (-HALF_TRACK, -REAR_AXLE),
    ]
    .map(|(x, z)| Vec3 { x, y: 0.0, z })
}
