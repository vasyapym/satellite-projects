//! Public WebAssembly facade. Intentionally small: create/reset/step/params +
//! a zero-copy compact render buffer + telemetry. JavaScript never manipulates
//! individual particles.

mod config;
mod cosmology;
mod particles;
mod gravity;

use config::*;
use cosmology::{Background, Phase};
use particles::Particles;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsValue;

#[wasm_bindgen]
pub fn get_memory() -> JsValue {
    wasm_bindgen::memory()
}

/// Compact render layout: 5 floats per particle.
/// [ x, y, z, density(0..1), speed(0..~) ] in DISPLAY space (already scaled).
const STRIDE: usize = 5;

/// The Rust integrator supports at most 64 MAX_SUBSTEP-sized substeps per
/// public call. Keep the API input bounded to that same amount so a large
/// finite `dt_sim` cannot turn into one oversized unstable physics step.
const MAX_CALL_DT: f64 = MAX_SUBSTEP * 64.0;

#[wasm_bindgen]
pub struct Simulation {
    bg: Background,
    p: Particles,
    preset: u32,
    seed: u64,
    render: Vec<f32>,
}

#[wasm_bindgen]
impl Simulation {
    #[wasm_bindgen(constructor)]
    pub fn new(preset: u32, seed: u32) -> Simulation {
        // Install once at first construction. Even with `panic = "abort"`,
        // the hook runs before the abort, so any future panic prints its real
        // message + file:line to the browser console instead of a bare
        // "RuntimeError: Unreachable code should not be executed".
        console_error_panic_hook::set_once();

        let count = preset_count(preset);
        let bg = Background::new(Cosmology::default());
        let p = Particles::seeded(count, seed as u64);
        let mut sim = Simulation { bg, p, preset, seed: seed as u64, render: vec![0.0; count * STRIDE] };
        sim.refresh_render();
        sim
    }

    /// Reset to initial conditions with a new seed, keeping the current preset.
    pub fn reset(&mut self, seed: u32) {
        self.seed = seed as u64;
        self.bg.reset();
        self.p = Particles::seeded(preset_count(self.preset), self.seed);
        self.render = vec![0.0; self.p.n * STRIDE];
        self.refresh_render();
    }

    /// Change particle resolution -> deterministic reinitialization.
    pub fn set_resolution(&mut self, preset: u32) {
        self.preset = preset;
        self.bg.reset();
        self.p = Particles::seeded(preset_count(preset), self.seed);
        self.render = vec![0.0; self.p.n * STRIDE];
        self.refresh_render();
    }

    /// Update cosmological density parameters (background only; continues run).
    pub fn set_params(&mut self, omega_r: f64, omega_m: f64, omega_k: f64, omega_lambda: f64, h0: f64) {
        self.bg.cosmo = Cosmology { omega_r, omega_m, omega_k, omega_lambda, h0 };
    }

    /// Advance by `dt_sim` simulation-time units.
    ///
    /// Invalid deltas are ignored at the WASM boundary. Valid deltas are
    /// capped to the work budget of 64 bounded substeps so callers cannot
    /// accidentally request an integrator step larger than its stability
    /// envelope.
    pub fn step(&mut self, dt_sim: f64) {
        if !dt_sim.is_finite() || dt_sim <= 0.0 {
            return;
        }

        let dt_sim = dt_sim.min(MAX_CALL_DT);
        let steps = (dt_sim / MAX_SUBSTEP).ceil() as usize;
        let dt = dt_sim / steps as f64;

        for _ in 0..steps {
            self.bg.advance(dt);
            gravity::leapfrog_step(&mut self.p, self.bg.a, self.bg.h, dt);
        }

        self.refresh_render();
    }

    fn refresh_render(&mut self) {
        self.p.recompute_density();
        let ds = self.bg.display_scale();
        for i in 0..self.p.n {
            let vx = self.p.vel[i * 3];
            let vy = self.p.vel[i * 3 + 1];
            let vz = self.p.vel[i * 3 + 2];
            let speed = (vx * vx + vy * vy + vz * vz).sqrt();
            let o = i * STRIDE;
            self.render[o] = self.p.pos[i * 3] * ds;
            self.render[o + 1] = self.p.pos[i * 3 + 1] * ds;
            self.render[o + 2] = self.p.pos[i * 3 + 2] * ds;
            self.render[o + 3] = self.p.density[i];
            self.render[o + 4] = speed;
        }
    }

    // --- Zero-copy render buffer access ---
    pub fn render_ptr(&self) -> *const f32 { self.render.as_ptr() }
    pub fn render_len(&self) -> usize { self.render.len() }
    pub fn stride(&self) -> usize { STRIDE }
    pub fn particle_count(&self) -> usize { self.p.n }

    // --- Telemetry ---
    pub fn scale_factor(&self) -> f64 { self.bg.a }
    pub fn hubble(&self) -> f64 { self.bg.h }
    pub fn temperature(&self) -> f64 { self.bg.temperature() }
    pub fn sim_time(&self) -> f64 { self.bg.t }
    pub fn phase(&self) -> u32 { self.bg.phase() as u32 }

    /// Dominant background component: 0 radiation, 1 matter, 2 dark energy.
    pub fn dominant(&self) -> u32 {
        let a = self.bg.a;
        let c = &self.bg.cosmo;
        let r = c.omega_r / a.powi(4);
        let m = c.omega_m / a.powi(3);
        let l = c.omega_lambda;
        if r >= m && r >= l { 0 } else if m >= l { 1 } else { 2 }
    }

    #[cfg(test)]
    fn simulation_state(&self) -> (f64, f64) {
        (self.bg.a, self.bg.t)
    }
}

fn _phase_marker(_: Phase) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn step_ignores_non_finite_and_non_positive_dt() {
        let mut sim = Simulation::new(0, 1);
        let before = sim.simulation_state();

        sim.step(f64::NAN);
        assert_eq!(sim.simulation_state(), before);

        sim.step(f64::INFINITY);
        assert_eq!(sim.simulation_state(), before);

        sim.step(f64::NEG_INFINITY);
        assert_eq!(sim.simulation_state(), before);

        sim.step(0.0);
        assert_eq!(sim.simulation_state(), before);

        sim.step(-1.0);
        assert_eq!(sim.simulation_state(), before);
    }

        #[test]
    fn stepping_from_a_min_keeps_state_finite() {
        // Reproduces the browser scenario: fresh sim at A_MIN, many frames.
        let mut sim = Simulation::new(0, 1);
        for _ in 0..300 {
            sim.step(0.0025); // matches timeScale 0.05 * dt ~0.05
        }
        for &v in &sim.render {
            assert!(v.is_finite(), "render buffer went non-finite");
        }
    }

    #[test]
    fn call_dt_budget_matches_integrator_budget() {
        assert_eq!(MAX_CALL_DT, MAX_SUBSTEP * 64.0);
        assert_eq!(MAX_CALL_DT, 0.128);
    }
}