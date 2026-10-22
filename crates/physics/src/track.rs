use super::{Segment, World, norm, scale};
use chassis::Ground;
use contracts::Vec3;

pub(super) fn normal(forward: &Vec3) -> Vec3 {
    let n = Vec3 {
        x: -forward.y * forward.x,
        y: 1.0 - forward.y * forward.y,
        z: -forward.y * forward.z,
    };
    scale(&n, 1.0 / norm(&n))
}

impl World {
    pub(super) fn nearest(&self, x: f64, z: f64, hint: u32) -> (usize, f64) {
        let count = self.segments.len();
        let mut best = (0, 0.0);
        let mut distance = f64::INFINITY;
        for offset in -2_i64..=2 {
            let index = (i64::from(hint) + offset).rem_euclid(count as i64) as usize;
            let s = &self.segments[index];
            let dx = x - s.from.x;
            let dz = z - s.from.z;
            let t = ((dx * s.delta.x + dz * s.delta.z)
                / (s.delta.x * s.delta.x + s.delta.z * s.delta.z))
                .clamp(0.0, 1.0);
            let d = (dx - t * s.delta.x) * (dx - t * s.delta.x)
                + (dz - t * s.delta.z) * (dz - t * s.delta.z);
            if d < distance {
                best = (index, t);
                distance = d;
            }
        }
        best
    }

    pub(super) fn ground_at(&self, point: &Vec3, hint: u32) -> Ground {
        let (i, t) = self.nearest(point.x, point.z, hint);
        let Segment {
            from,
            delta,
            normal,
            ..
        } = &self.segments[i];
        Ground {
            height: from.y + t * delta.y,
            normal: [normal.x, normal.y, normal.z],
        }
    }

    pub(super) fn project(&self, point: &Vec3, hint: u32) -> (u32, f64) {
        let (i, t) = self.nearest(point.x, point.z, hint);
        let s = &self.segments[i];
        let distance = s.start + t * s.length;
        (
            i as u32,
            if distance >= self.length {
                distance - self.length
            } else {
                distance
            },
        )
    }
}
