//! Perturbation subsystem: comoving positions + peculiar velocities, seeded
//! initial conditions, and an O(N) grid density estimate for rendering.

use crate::config::*;

/// Deterministic PRNG (SplitMix64) — a refresh reproduces the same universe.
pub struct Rng(u64);
impl Rng {
    pub fn new(seed: u64) -> Self { Rng(seed ^ 0x9E37_79B9_7F4A_7C15) }
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    /// Uniform in [0,1).
    pub fn unit(&mut self) -> f64 { (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64 }
    /// Approx standard normal via sum of uniforms (fast, deterministic).
    pub fn normal(&mut self) -> f64 {
        let s: f64 = (0..12).map(|_| self.unit()).sum();
        s - 6.0
    }
}

pub struct Particles {
    pub n: usize,
    pub pos: Vec<f32>, // comoving, xyz interleaved, in [-1,1]
    pub vel: Vec<f32>, // peculiar velocity, xyz interleaved
    pub acc: Vec<f32>, // acceleration scratch, xyz interleaved
    pub density: Vec<f32>, // normalized [0,1] per particle
}

impl Particles {
    /// Nearly-homogeneous field with small seeded perturbations. Density seeds
    /// are injected as gentle displacements so structure can grow under gravity
    /// rather than as a trivial radial explosion.
    pub fn seeded(count: usize, seed: u64) -> Self {
        let mut rng = Rng::new(seed);
        let mut pos = vec![0.0f32; count * 3];
        let mut vel = vec![0.0f32; count * 3];

        // A few random over-density centers give a repeatable large-scale morphology.
        const CENTERS: usize = 6;
        let mut cx = [0.0f64; CENTERS];
        let mut cy = [0.0f64; CENTERS];
        let mut cz = [0.0f64; CENTERS];
        for k in 0..CENTERS {
            cx[k] = rng.unit() * 2.0 - 1.0;
            cy[k] = rng.unit() * 2.0 - 1.0;
            cz[k] = rng.unit() * 2.0 - 1.0;
        }

        for i in 0..count {
            let mut x = rng.unit() * 2.0 - 1.0;
            let mut y = rng.unit() * 2.0 - 1.0;
            let mut z = rng.unit() * 2.0 - 1.0;

            // Small perturbation pulling toward the nearest seed center.
            let amp = 0.04;
            let mut best = f64::MAX;
            let (mut dx, mut dy, mut dz) = (0.0, 0.0, 0.0);
            for k in 0..CENTERS {
                let (ex, ey, ez) = (cx[k] - x, cy[k] - y, cz[k] - z);
                let d2 = ex * ex + ey * ey + ez * ez + 1e-3;
                if d2 < best { best = d2; dx = ex; dy = ey; dz = ez; }
            }
            let inv = amp / best.sqrt();
            x += dx * inv; y += dy * inv; z += dz * inv;

            pos[i * 3] = x.clamp(-1.0, 1.0) as f32;
            pos[i * 3 + 1] = y.clamp(-1.0, 1.0) as f32;
            pos[i * 3 + 2] = z.clamp(-1.0, 1.0) as f32;

            // Tiny initial peculiar velocities.
            let v = 0.01;
            vel[i * 3] = (rng.normal() * v) as f32;
            vel[i * 3 + 1] = (rng.normal() * v) as f32;
            vel[i * 3 + 2] = (rng.normal() * v) as f32;
        }

        Particles {
            n: count,
            pos,
            vel,
            acc: vec![0.0f32; count * 3],
            density: vec![0.0f32; count],
        }
    }

    /// O(N) density estimate via a uniform grid; normalized to [0,1].
    pub fn recompute_density(&mut self) {
        let g = DENSITY_GRID;
        let mut counts = vec![0u32; g * g * g];
        let cell = |c: f32| -> usize {
            (((c + BOX_HALF) / (2.0 * BOX_HALF) * g as f32) as isize)
                .clamp(0, g as isize - 1) as usize
        };
        for i in 0..self.n {
            let ix = cell(self.pos[i * 3]);
            let iy = cell(self.pos[i * 3 + 1]);
            let iz = cell(self.pos[i * 3 + 2]);
            counts[(ix * g + iy) * g + iz] += 1;
        }
        let max = counts.iter().copied().max().unwrap_or(1).max(1) as f32;
        for i in 0..self.n {
            let ix = cell(self.pos[i * 3]);
            let iy = cell(self.pos[i * 3 + 1]);
            let iz = cell(self.pos[i * 3 + 2]);
            let c = counts[(ix * g + iy) * g + iz] as f32;
            self.density[i] = (c / max).powf(0.5); // gamma for visual contrast
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeded_is_deterministic() {
        let a = Particles::seeded(1000, 42);
        let b = Particles::seeded(1000, 42);
        assert_eq!(a.pos, b.pos);
        assert_eq!(a.vel, b.vel);
    }

    #[test]
    fn positions_within_box() {
        let p = Particles::seeded(5000, 7);
        for &c in &p.pos {
            assert!(c >= -1.0 && c <= 1.0);
        }
    }

    #[test]
    fn density_normalized() {
        let mut p = Particles::seeded(5000, 7);
        p.recompute_density();
        assert!(p.density.iter().all(|&d| (0.0..=1.0).contains(&d)));
    }
}
