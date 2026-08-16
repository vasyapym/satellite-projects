//! Homogeneous background: integrates the scale factor via the Friedmann
//! equation, derives a parameterized temperature proxy, and classifies the
//! cosmological phase. This subsystem is intentionally decoupled from the
//! N-body perturbations so the renderer never touches cosmology math.

use crate::config::*;

#[derive(Clone, Copy, PartialEq)]
pub enum Phase {
    Inflation = 0,
    RadiationExpansion = 1,
    Cooling = 2,
    StructureFormation = 3,
}

pub struct Background {
    pub cosmo: Cosmology,
    pub a: f64,      // scale factor
    pub h: f64,      // current expansion rate
    pub t: f64,      // accumulated simulation time
}

impl Background {
    pub fn new(cosmo: Cosmology) -> Self {
        let a = A_MIN;
        let h = cosmo.hubble(a);
        Background { cosmo, a, h, t: 0.0 }
    }

    pub fn reset(&mut self) {
        self.a = A_MIN;
        self.h = self.cosmo.hubble(self.a);
        self.t = 0.0;
    }

    /// Advance the background by dt using RK4 on da/dt.
    /// During the toy inflationary regime we impose de Sitter growth
    /// (da/dt = a * H_INFLATION); afterwards, standard Friedmann dynamics.
    pub fn advance(&mut self, dt: f64) {
        let f = |a: f64| -> f64 {
            let a = a.max(1.0e-8);
            if a < A_INFLATION_END {
                a * H_INFLATION
            } else {
                a * self.cosmo.hubble(a)
            }
        };
        let a0 = self.a;
        let k1 = f(a0);
        let k2 = f(a0 + 0.5 * dt * k1);
        let k3 = f(a0 + 0.5 * dt * k2);
        let k4 = f(a0 + dt * k3);
        self.a = (a0 + (dt / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)).min(A_MAX);
        self.h = if self.a < A_INFLATION_END {
            H_INFLATION
        } else {
            self.cosmo.hubble(self.a)
        };
        self.t += dt;
    }

    /// Temperature proxy, normalized to [~0, 1] with T ∝ 1/a.
    pub fn temperature(&self) -> f64 {
        (T_REFERENCE / self.a).min(1.0)
    }

    pub fn phase(&self) -> Phase {
        if self.a < A_INFLATION_END {
            Phase::Inflation
        } else if self.a < A_RADIATION_END {
            Phase::RadiationExpansion
        } else if self.a < A_COOLING_END {
            Phase::Cooling
        } else {
            Phase::StructureFormation
        }
    }

    /// Log-mapped display scale so global expansion is visible inside a fixed
    /// camera frame: a in [A_MIN, A_MAX] -> [0.15, 1.0].
    pub fn display_scale(&self) -> f32 {
        let lo = A_MIN.ln();
        let hi = A_MAX.ln();
        let f = ((self.a.ln() - lo) / (hi - lo)).clamp(0.0, 1.0);
        (0.15 + 0.85 * f) as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scale_factor_grows_monotonically() {
        let mut bg = Background::new(Cosmology::default());
        let mut prev = bg.a;
        for _ in 0..500 {
            bg.advance(1.0e-3);
            assert!(bg.a >= prev - 1e-12, "a must not decrease");
            prev = bg.a;
        }
        assert!(bg.a > A_MIN);
    }

    #[test]
    fn radiation_dominated_hubble_scales_as_a_minus_two() {
        // With only radiation, H(a) ∝ a^-2.
        let cosmo = Cosmology { omega_r: 1.0, omega_m: 0.0, omega_k: 0.0, omega_lambda: 0.0, h0: 1.0 };
        let h1 = cosmo.hubble(0.1);
        let h2 = cosmo.hubble(0.2);
        let ratio = h1 / h2;
        assert!((ratio - 4.0).abs() < 1e-6, "expected 4x, got {ratio}");
    }

    #[test]
    fn temperature_decreases_as_universe_expands() {
        let mut bg = Background::new(Cosmology::default());
        let t0 = bg.temperature();
        for _ in 0..1000 { bg.advance(1.0e-3); }
        assert!(bg.temperature() < t0);
    }
}
