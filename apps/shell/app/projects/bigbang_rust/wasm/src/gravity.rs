//! Gravitational dynamics: a 3D Barnes-Hut octree for O(N log N) forces and a
//! kick-drift-kick (leapfrog) integrator with Hubble drag in the expanding
//! frame. Softened, deterministic, normalized units.

use crate::config::*;
use crate::particles::Particles;

#[derive(Clone, Copy)]
struct Node {
    // Center of mass and total mass (uniform particle mass = 1).
    com: [f64; 3],
    mass: f64,
    // Cube: center + half-size.
    center: [f64; 3],
    half: f64,
    // Index of first child in `nodes` (children are contiguous 8), or usize::MAX.
    children: usize,
    // If leaf holding a single body, its index; else usize::MAX.
    body: usize,
    count: u32,
}

pub struct Octree {
    nodes: Vec<Node>,
}

const NONE: usize = usize::MAX;

impl Octree {
    pub fn build(p: &Particles) -> Self {
        let half = (BOX_HALF as f64) * 1.05;
        let root = Node {
            com: [0.0; 3],
            mass: 0.0,
            center: [0.0; 3],
            half,
            children: NONE,
            body: NONE,
            count: 0,
        };
        let mut tree = Octree { nodes: vec![root] };
        for i in 0..p.n {
            let pt = [p.pos[i * 3] as f64, p.pos[i * 3 + 1] as f64, p.pos[i * 3 + 2] as f64];
            tree.insert(0, i, pt);
        }
        tree.finalize(0);
        tree
    }

    fn octant(center: &[f64; 3], pt: &[f64; 3]) -> usize {
        (if pt[0] > center[0] { 1 } else { 0 })
            | (if pt[1] > center[1] { 2 } else { 0 })
            | (if pt[2] > center[2] { 4 } else { 0 })
    }

    fn subdivide(&mut self, node: usize) {
        let (center, half) = { let n = &self.nodes[node]; (n.center, n.half) };
        let h = half * 0.5;
        let base = self.nodes.len();
        for oct in 0..8 {
            let cx = center[0] + if oct & 1 != 0 { h } else { -h };
            let cy = center[1] + if oct & 2 != 0 { h } else { -h };
            let cz = center[2] + if oct & 4 != 0 { h } else { -h };
            self.nodes.push(Node {
                com: [0.0; 3], mass: 0.0,
                center: [cx, cy, cz], half: h,
                children: NONE, body: NONE, count: 0,
            });
        }
        self.nodes[node].children = base;
    }

    fn insert(&mut self, mut node: usize, body: usize, pt: [f64; 3]) {
        loop {
            let (count, children, existing) =
                { let n = &self.nodes[node]; (n.count, n.children, n.body) };

            if count == 0 && children == NONE {
                let n = &mut self.nodes[node];
                n.body = body; n.count = 1;
                n.com = pt; n.mass = 1.0;
                return;
            }

            if children == NONE {
                // Leaf with one body: subdivide and push the existing body down.
                self.subdivide(node);
                let ex_pt = self.nodes[node].com;
                let ex_body = existing;
                self.nodes[node].body = NONE;
                let base = self.nodes[node].children;
                let oct = Self::octant(&self.nodes[node].center, &ex_pt);
                self.insert(base + oct, ex_body, ex_pt);
                // fallthrough to place the new body via loop
            }

            let base = self.nodes[node].children;
            self.nodes[node].count += 1;
            let oct = Self::octant(&self.nodes[node].center, &pt);
            node = base + oct;
        }
    }

    /// Post-order accumulate center of mass and mass for internal nodes.
    fn finalize(&mut self, node: usize) {
        let children = self.nodes[node].children;
        if children == NONE { return; }
        let mut mass = 0.0;
        let mut com = [0.0; 3];
        for c in 0..8 {
            self.finalize(children + c);
            let ch = &self.nodes[children + c];
            if ch.mass > 0.0 {
                mass += ch.mass;
                com[0] += ch.com[0] * ch.mass;
                com[1] += ch.com[1] * ch.mass;
                com[2] += ch.com[2] * ch.mass;
            }
        }
        if mass > 0.0 {
            com[0] /= mass; com[1] /= mass; com[2] /= mass;
        }
        let n = &mut self.nodes[node];
        n.mass = mass; n.com = com;
    }

    /// Softened acceleration on `pt` (excluding self via body index).
    pub fn accel(&self, pt: [f64; 3], self_body: usize) -> [f64; 3] {
        let mut a = [0.0; 3];
        self.accel_rec(0, pt, self_body, &mut a);
        a
    }

    fn accel_rec(&self, node: usize, pt: [f64; 3], self_body: usize, a: &mut [f64; 3]) {
        let n = &self.nodes[node];
        if n.mass == 0.0 { return; }
        if n.children == NONE {
            if n.body == self_body || n.body == NONE { return; }
        }
        let dx = n.com[0] - pt[0];
        let dy = n.com[1] - pt[1];
        let dz = n.com[2] - pt[2];
        let r2 = dx * dx + dy * dy + dz * dz + SOFTENING * SOFTENING;
        let size = 2.0 * n.half;

        if n.children == NONE || (size * size) < THETA * THETA * r2 {
            // Treat this node as a single mass.
            let inv_r = 1.0 / r2.sqrt();
            let inv_r3 = inv_r / r2;
            let f = G_EFF * n.mass * inv_r3;
            a[0] += f * dx; a[1] += f * dy; a[2] += f * dz;
        } else {
            for c in 0..8 { self.accel_rec(n.children + c, pt, self_body, a); }
        }
    }
}

/// One kick-drift-kick leapfrog step in the expanding frame:
///   dv/dt = g/a^3 - 2 H v ,  dx/dt = v / a^2
/// (comoving x, peculiar v, normalized units). `a` and `h` are the background
/// values (treated as constant across the small substep).
pub fn leapfrog_step(p: &mut Particles, a: f64, h: f64, dt: f64) {
    let a3 = (a * a * a).max(1e-9);
    let a2 = (a * a).max(1e-9);
    let drag = (2.0 * h) as f32;
    let inv_a3 = (1.0 / a3) as f32;
    let inv_a2 = (1.0 / a2) as f32;
    let dth = (0.5 * dt) as f32;
    let dtf = dt as f32;

    // First kick uses current accelerations.
    compute_accel(p);
    for i in 0..p.n {
        for d in 0..3 {
            let idx = i * 3 + d;
            let g = p.acc[idx] * inv_a3;
            p.vel[idx] += (g - drag * p.vel[idx]) * dth;
        }
    }
    // Drift.
    for i in 0..p.n * 3 {
        // reuse index math per-component below to apply inv_a2
    }
    for i in 0..p.n {
        for d in 0..3 {
            let idx = i * 3 + d;
            p.pos[idx] += p.vel[idx] * inv_a2 * dtf;
            // Periodic wrap keeps particles in the display cube.
            if p.pos[idx] > 1.0 { p.pos[idx] -= 2.0; }
            if p.pos[idx] < -1.0 { p.pos[idx] += 2.0; }
        }
    }
    // Second kick uses updated accelerations.
    compute_accel(p);
    for i in 0..p.n {
        for d in 0..3 {
            let idx = i * 3 + d;
            let g = p.acc[idx] * inv_a3;
            p.vel[idx] += (g - drag * p.vel[idx]) * dth;
        }
    }
}

fn compute_accel(p: &mut Particles) {
    let tree = Octree::build(p);
    for i in 0..p.n {
        let pt = [p.pos[i * 3] as f64, p.pos[i * 3 + 1] as f64, p.pos[i * 3 + 2] as f64];
        let acc = tree.accel(pt, i);
        p.acc[i * 3] = acc[0] as f32;
        p.acc[i * 3 + 1] = acc[1] as f32;
        p.acc[i * 3 + 2] = acc[2] as f32;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_bodies_attract() {
        let mut p = Particles {
            n: 2,
            pos: vec![-0.3, 0.0, 0.0, 0.3, 0.0, 0.0],
            vel: vec![0.0; 6],
            acc: vec![0.0; 6],
            density: vec![0.0; 2],
        };
        compute_accel(&mut p);
        // Left body pulled +x, right body pulled -x.
        assert!(p.acc[0] > 0.0, "left ax = {}", p.acc[0]);
        assert!(p.acc[3] < 0.0, "right ax = {}", p.acc[3]);
    }

    #[test]
    fn barnes_hut_approximates_direct_sum() {
        let p = Particles::seeded(400, 3);
        let tree = Octree::build(&p);
        let i = 10usize;
        let pt = [p.pos[i*3] as f64, p.pos[i*3+1] as f64, p.pos[i*3+2] as f64];
        let bh = tree.accel(pt, i);

        // Direct O(N^2) reference.
        let mut d = [0.0f64; 3];
        for j in 0..p.n {
            if j == i { continue; }
            let dx = p.pos[j*3] as f64 - pt[0];
            let dy = p.pos[j*3+1] as f64 - pt[1];
            let dz = p.pos[j*3+2] as f64 - pt[2];
            let r2 = dx*dx + dy*dy + dz*dz + SOFTENING*SOFTENING;
            let f = G_EFF / (r2 * r2.sqrt());
            d[0] += f*dx; d[1] += f*dy; d[2] += f*dz;
        }
        let mag_d = (d[0]*d[0]+d[1]*d[1]+d[2]*d[2]).sqrt();
        let err = (((bh[0]-d[0]).powi(2)+(bh[1]-d[1]).powi(2)+(bh[2]-d[2]).powi(2)).sqrt())
            / mag_d.max(1e-9);
        assert!(err < 0.2, "relative error {err} too high");
    }
}
