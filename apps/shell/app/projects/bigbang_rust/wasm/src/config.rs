//! Central configuration. All magic numbers live here so the model is auditable.
//! The engine works in NORMALIZED units, not SI. The UI exposes recognizable
//! cosmological density parameters; internal dynamics are dimensionless.

/// Display-space is a fixed cube; comoving coordinates live in [-1, 1].
pub const BOX_HALF: f32 = 1.0;

/// Scale-factor bounds. a_min is the earliest state we integrate from.
pub const A_MIN: f64 = 1.0e-3;
pub const A_MAX: f64 = 1.0;

/// End of the toy inflationary (de Sitter) regime.
pub const A_INFLATION_END: f64 = 8.0e-3;
/// Effective de Sitter expansion rate during inflation (normalized).
pub const H_INFLATION: f64 = 55.0;

/// Phase-classification thresholds on the scale factor.
pub const A_RADIATION_END: f64 = 6.0e-2; // radiation-dominated rapid expansion
pub const A_COOLING_END: f64 = 3.0e-1;   // cooling / matter takes over

/// Temperature proxy: T ∝ 1/a, normalized so a = A_MIN → 1.0.
pub const T_REFERENCE: f64 = A_MIN;

/// Effective gravitational coupling in normalized units (tuned for visual
/// structure growth within the interactive scale-factor range).
pub const G_EFF: f64 = 0.06;

/// Plummer softening length (comoving) — prevents force singularities.
pub const SOFTENING: f64 = 0.02;

/// Barnes-Hut opening angle. Smaller = more accurate, slower.
pub const THETA: f64 = 0.7;

/// Largest simulation-time substep the integrator will take (stability bound).
pub const MAX_SUBSTEP: f64 = 2.0e-3;

/// Grid resolution used for the O(N) density estimate feeding the renderer.
pub const DENSITY_GRID: usize = 32;

/// Particle-count presets (Low / Medium / High).
pub const PRESETS: [usize; 3] = [2_048, 8_192, 32_768];

pub fn preset_count(preset: u32) -> usize {
    let idx = (preset as usize).min(PRESETS.len() - 1);
    PRESETS[idx]
}

/// Density parameters for the homogeneous background (Friedmann sources).
#[derive(Clone, Copy)]
pub struct Cosmology {
    pub omega_r: f64,      // radiation
    pub omega_m: f64,      // matter (baryonic + dark)
    pub omega_k: f64,      // curvature
    pub omega_lambda: f64, // dark energy
    pub h0: f64,           // present expansion rate (normalized)
}

impl Default for Cosmology {
    fn default() -> Self {
        // Roughly ΛCDM-flavored, normalized. Not SI, deliberately.
        Cosmology {
            omega_r: 9.0e-5,
            omega_m: 0.315,
            omega_k: 0.0,
            omega_lambda: 0.685,
            h0: 1.0,
        }
    }
}

impl Cosmology {
    /// Friedmann expansion rate H(a) = H0 * sqrt(Ωr a^-4 + Ωm a^-3 + Ωk a^-2 + ΩΛ).
    pub fn hubble(&self, a: f64) -> f64 {
        let a = a.max(1.0e-8);
        let e2 = self.omega_r / a.powi(4)
            + self.omega_m / a.powi(3)
            + self.omega_k / (a * a)
            + self.omega_lambda;
        self.h0 * e2.max(0.0).sqrt()
    }
}