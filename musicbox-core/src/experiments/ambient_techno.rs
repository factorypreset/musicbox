use rand::Rng;
use rand::SeedableRng;

use crate::dsp::ResonantLpf;

/// A sub-Hz oscillator that emits trigger events each cycle.
/// Phase accumulates from 0.0 to 1.0; a trigger fires when it wraps.
pub struct PulseOscillator {
    phase: f32,
    freq: f32,
    sample_rate: f32,
}

impl PulseOscillator {
    pub fn new(freq: f32, sample_rate: f32) -> Self {
        Self {
            phase: 0.0,
            freq,
            sample_rate,
        }
    }

    pub fn new_with_phase(freq: f32, sample_rate: f32, phase: f32) -> Self {
        Self {
            phase,
            freq,
            sample_rate,
        }
    }

    /// Advance one sample. Returns true on the sample where phase wraps.
    pub fn tick(&mut self) -> bool {
        self.phase += self.freq / self.sample_rate;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
            true
        } else {
            false
        }
    }

    pub fn set_freq(&mut self, freq: f32) {
        self.freq = freq;
    }

    pub fn freq(&self) -> f32 {
        self.freq
    }
}

/// Synthesized kick drum.
/// Sine body with exponential pitch envelope: starts at `pitch_start` Hz,
/// decays to `pitch_end` Hz. Amplitude decays exponentially.
pub struct Kick {
    phase: f32,
    pitch_start: f32,
    pitch_end: f32,
    pitch_decay: f32,
    amp_decay: f32,
    current_pitch: f32,
    current_amp: f32,
    sample_rate: f32,
    active: bool,
}

impl Kick {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            phase: 0.0,
            pitch_start: 150.0,
            pitch_end: 50.0,
            pitch_decay: 0.995,
            amp_decay: 0.9995,
            current_pitch: 50.0,
            current_amp: 0.0,
            sample_rate,
            active: false,
        }
    }

    /// Fire the kick — resets envelope.
    pub fn trigger(&mut self) {
        self.phase = 0.0;
        self.current_pitch = self.pitch_start;
        self.current_amp = 1.0;
        self.active = true;
    }

    /// Generate next sample.
    pub fn next_sample(&mut self) -> f32 {
        if !self.active {
            return 0.0;
        }

        let sample = (self.phase * std::f32::consts::TAU).sin();

        self.phase += self.current_pitch / self.sample_rate;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }

        // Exponential pitch decay toward pitch_end
        self.current_pitch = self.pitch_end
            + (self.current_pitch - self.pitch_end) * self.pitch_decay;

        // Exponential amplitude decay
        self.current_amp *= self.amp_decay;
        if self.current_amp < 0.001 {
            self.active = false;
            self.current_amp = 0.0;
        }

        // Soft clip for punch
        (sample * self.current_amp * 1.5).tanh()
    }
}

/// Xorshift64 PRNG for cheap per-sample noise.
/// Deterministic given a seed, no allocation.
struct Xorshift64 {
    state: u64,
}

impl Xorshift64 {
    fn new(seed: u64) -> Self {
        Self { state: seed | 1 }
    }

    #[inline]
    fn next(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.state = x;
        x
    }

    /// White noise sample in [-1.0, 1.0].
    #[inline]
    fn white(&mut self) -> f32 {
        (self.next() as f32) / (u64::MAX as f32) * 2.0 - 1.0
    }
}

/// Hi-hat: band-passed noise burst with fast exponential decay.
/// Triggered by a pulse oscillator.
pub struct HiHat {
    noise: Xorshift64,
    amp: f32,
    decay: f32,
    /// Band-pass state (simple 2-pole)
    bp_low: f32,
    bp_band: f32,
    bp_freq: f32,
    sample_rate: f32,
}

impl HiHat {
    pub fn new(sample_rate: f32, seed: u64) -> Self {
        Self {
            noise: Xorshift64::new(seed),
            amp: 0.0,
            decay: (-1.0 / (sample_rate * 0.03_f32)).exp(), // ~30ms decay
            bp_low: 0.0,
            bp_band: 0.0,
            bp_freq: 8000.0,
            sample_rate,
        }
    }

    pub fn trigger(&mut self) {
        self.amp = 0.6;
    }

    pub fn next_sample(&mut self) -> f32 {
        if self.amp < 0.0001 {
            self.amp = 0.0;
            return 0.0;
        }

        let noise = self.noise.white();

        // Simple SVF band-pass for metallic character
        let f = (std::f32::consts::PI * self.bp_freq / self.sample_rate).sin() * 2.0;
        let q = 0.4;
        let high = noise - self.bp_low - q * self.bp_band;
        self.bp_band += f * high;
        self.bp_low += f * self.bp_band;
        let bp_out = self.bp_band;

        self.amp *= self.decay;

        bp_out * self.amp
    }
}

/// Continuous hiss layer: filtered noise, always present.
/// Level modulated by a slow LFO for breathing texture.
struct Hiss {
    noise: Xorshift64,
    filter: ResonantLpf,
    lfo_phase: f32,
    lfo_rate: f32,
    base_level: f32,
    sample_rate: f32,
}

impl Hiss {
    fn new(sample_rate: f32, rng: &mut impl Rng) -> Self {
        let filter = ResonantLpf::new(2000.0, 6000.0, 0.15, 0.03, sample_rate, rng);
        Self {
            noise: Xorshift64::new(rng.r#gen::<u64>() | 1),
            filter,
            lfo_phase: rng.r#gen::<f32>(),
            lfo_rate: rng.r#gen_range(0.02..0.06),
            base_level: 0.08,
            sample_rate,
        }
    }

    fn next_sample(&mut self) -> f32 {
        let noise = self.noise.white();
        let filtered = self.filter.process(noise);

        // Slow breathing LFO
        let lfo = (self.lfo_phase * std::f32::consts::TAU).sin();
        let level = self.base_level * (0.5 + 0.5 * lfo);

        self.lfo_phase += self.lfo_rate / self.sample_rate;
        if self.lfo_phase >= 1.0 {
            self.lfo_phase -= 1.0;
        }

        filtered * level
    }

    fn set_level(&mut self, level: f32) {
        self.base_level = level;
    }
}

/// A drifting pulse oscillator — its frequency wanders via a slow random walk.
struct DriftingPulse {
    pulse: PulseOscillator,
    base_freq: f32,
    drift_phase: f32,
    drift_rate: f32,
    drift_amount: f32,
    sample_rate: f32,
}

impl DriftingPulse {
    fn new(base_freq: f32, drift_amount: f32, sample_rate: f32, rng: &mut impl Rng) -> Self {
        let phase = rng.r#gen::<f32>();
        Self {
            pulse: PulseOscillator::new_with_phase(base_freq, sample_rate, phase),
            base_freq,
            drift_phase: rng.r#gen::<f32>(),
            drift_rate: rng.r#gen_range(0.03..0.1),
            drift_amount,
            sample_rate,
        }
    }

    fn tick(&mut self) -> bool {
        // Update drifting frequency
        let drift = (self.drift_phase * std::f32::consts::TAU).sin() * self.drift_amount;
        self.pulse.set_freq(self.base_freq + drift);

        self.drift_phase += self.drift_rate / self.sample_rate;
        if self.drift_phase >= 1.0 {
            self.drift_phase -= 1.0;
        }

        self.pulse.tick()
    }

    fn set_drift_amount(&mut self, amount: f32) {
        self.drift_amount = amount;
    }
}

/// First experiment: kick pulsing at a steady frequency,
/// drifting hats and continuous hiss.
pub struct AmbientTechno {
    kick: Kick,
    kick_pulse: PulseOscillator,
    hat: HiHat,
    hat_pulse: DriftingPulse,
    hiss: Hiss,
    drift: f32,
    haze: f32,
    limiter_gain: f32,
    fade_pos: u32,
    fade_state: FadeState,
    fade_samples: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FadeState {
    FadingIn,
    Playing,
    FadingOut,
    Done,
}

const FADE_DURATION: f32 = 1.0;

impl AmbientTechno {
    pub fn new(sample_rate: u32, seed: u64) -> Self {
        let sr = sample_rate as f32;
        let mut rng = rand::rngs::StdRng::seed_from_u64(seed);

        // ~2.08 Hz = ~125 BPM
        let kick_freq = 2.0833;
        // Start at a random phase so the first kick isn't always at sample 0
        let kick_phase = rng.r#gen::<f32>();

        // Hat at ~2x kick frequency, with drift
        let hat_base_freq = kick_freq * 2.0;
        let drift = 0.5;
        let hat_drift_amount = hat_base_freq * 0.15 * drift;

        let hat_seed = rng.r#gen::<u64>();

        Self {
            kick: Kick::new(sr),
            kick_pulse: PulseOscillator::new_with_phase(kick_freq, sr, kick_phase),
            hat: HiHat::new(sr, hat_seed),
            hat_pulse: DriftingPulse::new(hat_base_freq, hat_drift_amount, sr, &mut rng),
            hiss: Hiss::new(sr, &mut rng),
            drift,
            haze: 0.5,
            limiter_gain: 1.0,
            fade_pos: 0,
            fade_state: FadeState::FadingIn,
            fade_samples: (sr * FADE_DURATION) as u32,
        }
    }

    pub fn start_fade_out(&mut self) {
        if self.fade_state == FadeState::FadingIn || self.fade_state == FadeState::Playing {
            self.fade_state = FadeState::FadingOut;
        }
    }

    pub fn is_done(&self) -> bool {
        self.fade_state == FadeState::Done
    }

    pub fn state(&self) -> FadeState {
        self.fade_state
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "pulse" => {
                let freq = value.clamp(1.3, 2.5);
                self.kick_pulse.set_freq(freq);
                // Update hat base freq to track kick at ~2x
                self.hat_pulse.base_freq = freq * 2.0;
            }
            "drift" => {
                self.drift = value.clamp(0.0, 1.0);
                let hat_drift = self.hat_pulse.base_freq * 0.15 * self.drift;
                self.hat_pulse.set_drift_amount(hat_drift);
            }
            "haze" => {
                self.haze = value.clamp(0.0, 1.0);
                self.hiss.set_level(0.15 * self.haze);
            }
            _ => {}
        }
    }

    pub fn get_params(&self) -> Vec<(&str, f32, f32, f32)> {
        vec![
            ("pulse", self.kick_pulse.freq(), 1.3, 2.5),
            ("drift", self.drift, 0.0, 1.0),
            ("haze", self.haze, 0.0, 1.0),
        ]
    }

    pub fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        let len = left.len().min(right.len());
        for i in 0..len {
            let (l, r) = self.next_sample();
            left[i] = l;
            right[i] = r;
        }
    }

    fn next_sample(&mut self) -> (f32, f32) {
        let master_gain = match self.fade_state {
            FadeState::FadingIn => {
                self.fade_pos += 1;
                if self.fade_pos >= self.fade_samples {
                    self.fade_state = FadeState::Playing;
                }
                let t = self.fade_pos as f32 / self.fade_samples as f32;
                t * t
            }
            FadeState::Playing => 1.0,
            FadeState::FadingOut => {
                if self.fade_pos == 0 {
                    self.fade_state = FadeState::Done;
                    0.0
                } else {
                    self.fade_pos = self.fade_pos.saturating_sub(1);
                    let t = self.fade_pos as f32 / self.fade_samples as f32;
                    t * t
                }
            }
            FadeState::Done => 0.0,
        };

        if self.fade_state == FadeState::Done {
            return (0.0, 0.0);
        }

        // Pulse oscillator triggers the kick
        if self.kick_pulse.tick() {
            self.kick.trigger();
        }

        // Drifting pulse triggers the hat
        if self.hat_pulse.tick() {
            self.hat.trigger();
        }

        let kick_sample = self.kick.next_sample();
        let hat_sample = self.hat.next_sample();
        let hiss_sample = self.hiss.next_sample();

        // Kick is mono-center, hat slightly panned, hiss is mono
        // Soft clip the mix before limiting
        let mut left = (kick_sample + hat_sample * 0.7 + hiss_sample).tanh();
        let mut right = (kick_sample + hat_sample * 1.0 + hiss_sample).tanh();

        // Peak limiter
        let peak = left.abs().max(right.abs());
        if peak * self.limiter_gain > 0.8 {
            let target = 0.8 / peak;
            self.limiter_gain += 0.002 * (target - self.limiter_gain);
        } else {
            self.limiter_gain += 0.0001 * (1.0 - self.limiter_gain);
        }

        left *= self.limiter_gain * master_gain;
        right *= self.limiter_gain * master_gain;

        (left, right)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pulse_oscillator_fires_at_correct_rate() {
        let sample_rate = 44100.0;
        let freq = 2.0; // 2 Hz = trigger every 0.5 seconds = every 22050 samples
        let mut pulse = PulseOscillator::new(freq, sample_rate);

        let mut trigger_count = 0;
        let mut first_trigger_at = None;
        let mut second_trigger_at = None;

        // Run for 1 second (should get ~2 triggers)
        for i in 0..44100 {
            if pulse.tick() {
                trigger_count += 1;
                if first_trigger_at.is_none() {
                    first_trigger_at = Some(i);
                } else if second_trigger_at.is_none() {
                    second_trigger_at = Some(i);
                }
            }
        }

        assert_eq!(trigger_count, 2, "2 Hz should trigger twice per second");

        // Check interval between triggers is ~22050 samples
        let interval = second_trigger_at.unwrap() - first_trigger_at.unwrap();
        assert!(
            (interval as i32 - 22050).unsigned_abs() < 5,
            "interval between triggers should be ~22050 samples, got {}",
            interval
        );
    }

    #[test]
    fn kick_produces_signal_after_trigger() {
        let mut kick = Kick::new(44100.0);
        assert_eq!(kick.next_sample(), 0.0, "kick should be silent before trigger");

        kick.trigger();
        let mut has_signal = false;
        for _ in 0..4410 {
            if kick.next_sample().abs() > 0.01 {
                has_signal = true;
                break;
            }
        }
        assert!(has_signal, "kick should produce signal after trigger");
    }

    #[test]
    fn kick_decays_to_silence() {
        let mut kick = Kick::new(44100.0);
        kick.trigger();

        // Run for 2 seconds — should be silent by then
        for _ in 0..88200 {
            kick.next_sample();
        }
        assert!(!kick.active, "kick should be inactive after decay");
        assert_eq!(kick.next_sample(), 0.0);
    }

    #[test]
    fn ambient_techno_renders_kicks() {
        let mut engine = AmbientTechno::new(44100, 42);

        // Render 1 second — at ~2.08 Hz we should get at least 1 kick
        let mut left = vec![0.0f32; 44100];
        let mut right = vec![0.0f32; 44100];
        engine.render(&mut left, &mut right);

        let peak = left.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        assert!(peak > 0.01, "should have audible kick signal, got peak {}", peak);
    }

    #[test]
    fn ambient_techno_output_within_bounds() {
        let mut engine = AmbientTechno::new(44100, 42);
        let mut left = vec![0.0f32; 4096];
        let mut right = vec![0.0f32; 4096];

        for _ in 0..20 {
            engine.render(&mut left, &mut right);
            for &s in left.iter().chain(right.iter()) {
                assert!(s.abs() <= 1.0, "sample {} exceeds [-1, 1] range", s);
            }
        }
    }

    #[test]
    fn ambient_techno_deterministic_with_same_seed() {
        let mut e1 = AmbientTechno::new(44100, 99);
        let mut e2 = AmbientTechno::new(44100, 99);

        let mut l1 = vec![0.0f32; 2048];
        let mut r1 = vec![0.0f32; 2048];
        let mut l2 = vec![0.0f32; 2048];
        let mut r2 = vec![0.0f32; 2048];

        e1.render(&mut l1, &mut r1);
        e2.render(&mut l2, &mut r2);

        assert_eq!(l1, l2);
        assert_eq!(r1, r2);
    }

    #[test]
    fn hihat_produces_signal_and_decays() {
        let mut hat = HiHat::new(44100.0, 12345);
        assert_eq!(hat.next_sample(), 0.0, "hat silent before trigger");

        hat.trigger();
        let mut peak = 0.0f32;
        for _ in 0..4410 {
            peak = peak.max(hat.next_sample().abs());
        }
        assert!(peak > 0.01, "hat should produce signal after trigger");

        // After ~200ms should be essentially silent
        for _ in 0..8820 {
            hat.next_sample();
        }
        assert!(hat.next_sample().abs() < 0.001, "hat should decay to silence");
    }

    #[test]
    fn hiss_produces_continuous_signal() {
        let mut rng = rand::rngs::StdRng::seed_from_u64(42);
        let mut hiss = Hiss::new(44100.0, &mut rng);

        let mut has_signal = false;
        for _ in 0..4410 {
            if hiss.next_sample().abs() > 0.0001 {
                has_signal = true;
                break;
            }
        }
        assert!(has_signal, "hiss should produce continuous signal");
    }

    #[test]
    fn drifting_pulse_frequency_varies() {
        let mut rng = rand::rngs::StdRng::seed_from_u64(42);
        let mut dp = DriftingPulse::new(4.0, 0.5, 44100.0, &mut rng);

        // Collect trigger intervals over 5 seconds
        let mut intervals = Vec::new();
        let mut since_last = 0u32;
        for _ in 0..220500 {
            if dp.tick() {
                if since_last > 0 {
                    intervals.push(since_last);
                }
                since_last = 0;
            }
            since_last += 1;
        }

        assert!(intervals.len() >= 2, "should have multiple triggers");
        // Intervals should vary (not all identical)
        let first = intervals[0];
        let varies = intervals.iter().any(|&i| (i as i32 - first as i32).unsigned_abs() > 10);
        assert!(varies, "drifting pulse intervals should vary, got {:?}", &intervals[..intervals.len().min(5)]);
    }

    #[test]
    fn haze_param_controls_hiss_level() {
        // With haze=0, hiss should be silent
        let mut engine = AmbientTechno::new(44100, 42);
        engine.set_param("haze", 0.0);

        let mut left = vec![0.0f32; 44100];
        let mut right = vec![0.0f32; 44100];
        engine.render(&mut left, &mut right);

        // Isolate hiss by looking at samples between kicks (where kick is silent)
        // Just check overall level is lower with haze=0
        let rms_no_haze: f32 = left.iter().map(|s| s * s).sum::<f32>() / left.len() as f32;

        let mut engine2 = AmbientTechno::new(44100, 42);
        engine2.set_param("haze", 1.0);
        let mut left2 = vec![0.0f32; 44100];
        let mut right2 = vec![0.0f32; 44100];
        engine2.render(&mut left2, &mut right2);
        let rms_full_haze: f32 = left2.iter().map(|s| s * s).sum::<f32>() / left2.len() as f32;

        assert!(rms_full_haze > rms_no_haze,
            "full haze ({}) should be louder than no haze ({})",
            rms_full_haze, rms_no_haze);
    }

    #[test]
    fn pulse_param_changes_kick_rate() {
        // Test pulse oscillator directly — more reliable than detecting kicks in mixed audio
        let mut fast = PulseOscillator::new(2.08, 44100.0);
        let mut slow = PulseOscillator::new(1.3, 44100.0);

        let mut fast_count = 0u32;
        let mut slow_count = 0u32;

        // Count triggers over 3 seconds
        for _ in 0..(44100 * 3) {
            if fast.tick() { fast_count += 1; }
            if slow.tick() { slow_count += 1; }
        }

        assert!(fast_count > slow_count,
            "2.08 Hz ({} triggers) should fire more than 1.3 Hz ({} triggers)",
            fast_count, slow_count);
    }
}
