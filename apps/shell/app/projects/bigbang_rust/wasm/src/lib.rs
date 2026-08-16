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

    /// Advance by `dt_sim` simulation-time units, subdivided into bounded
    /// substeps so large UI time-scales never destabilize the integrator.
    pub fn step(&mut self, dt_sim: f64) {
        if dt_sim <= 0.0 { return; }
        let steps = (dt_sim / MAX_SUBSTEP).ceil().max(1.0) as usize;
        let dt = dt_sim / steps as f64;
        for _ in 0..steps.min(64) {
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
}

fn _phase_marker(_: Phase) {}
