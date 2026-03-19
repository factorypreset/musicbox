# Generative Ambient Techno — Design

Multiple generative audio experiments built on shared DSP primitives from musicbox-core. First experiment: pulsing ambient techno with a steady kick pulse and drifting everything else.

## Musical Intent

Everything is described in terms of frequency. A kick drum is a pulse at ~2.08 Hz (equivalent to 125 BPM). Hi-hats pulse near double that. Dub stabs trigger at their own sub-Hz rate. There is no grid, no BPM, no beat counter — just oscillators and pulse frequencies, some steady, some drifting.

The kick's pulse frequency is the anchor. Other elements have their own pulse frequencies that are near-ratios of the kick but free to wander: a hat at ~4.1 Hz is roughly double-time, a stab at ~0.52 Hz is roughly every-other-beat, but none are locked. Drift emerges naturally from independent frequencies that phase in and out of alignment over time.

Reference conversions:
- 120 BPM = 2.0 Hz
- 125 BPM = 2.0833 Hz
- 130 BPM = 2.1667 Hz
- 140 BPM = 2.3333 Hz

## Architecture

### Shared DSP primitives

Extract reusable building blocks from `musicbox-core` so multiple engines can compose them freely. These already exist but are currently private to the `MusicBox` struct:

- `DelayLine` — fractional read, allpass building block
- `ResonantLpf` — state-variable filter with LFO-swept cutoff
- `DattorroReverb` — plate reverb (Mutable Instruments/Clouds port)
- `BbdDelay` — bucket-brigade delay emulation
- `PluckVoice` — Karplus-Strong string synthesis
- `Oscillator` — sine with LFO envelope, pitch drift, sparsity

Make these `pub` (or move to a `dsp` module) so new engines can import them.

### New DSP components needed

- **Kick drum** — sine body with pitch envelope (start ~150 Hz, sweep to ~50 Hz over ~50ms) + optional distortion/saturation. Triggered by a pulse oscillator.
- **Pulse oscillator** — a sub-Hz oscillator that fires trigger events each cycle. The kick's pulse oscillator holds steady; other elements' pulse oscillators drift freely. This is conceptually identical to the existing `Oscillator` but outputs triggers rather than audio.
- **Noise generator** — white/pink noise for hiss and hat synthesis
- **Hi-hat** — band-passed noise burst with fast exponential decay. Pulse frequency near 2x kick.
- **Dub stab** — chord (2-3 detuned oscillators), sharp attack, filtered, heavy reverb send. Pulse frequency near 0.5x kick.
- **Granular engine** — buffer of source material (could be generated or from a wavetable), random grain triggering with pitch/position/duration scatter

### Experiment structure

Each experiment is its own Rust engine struct with a `render()` method, compiled to WASM. The workspace gains a pattern:

```
musicbox-core/
  src/
    lib.rs          (MusicBox — original drone engine)
    dsp.rs          (shared primitives, extracted)
    experiments/
      mod.rs
      ambient_techno.rs   (first experiment)
```

Each experiment exposes:
- `new(sample_rate: u32, seed: u64) -> Self`
- `render(&mut self, left: &mut [f32], right: &mut [f32])`
- `set_param(name: &str, value: f32)`
- `get_params() -> Vec<(String, f32, f32, f32)>` — (name, value, min, max)

### Macro knobs (first experiment)

| Knob | Controls | Range |
|------|----------|-------|
| pulse | Kick pulse frequency in Hz | 1.3–2.5 (~80–150 BPM equivalent) |
| drift | How far other pulse frequencies wander from their base ratio | 0.0–1.0 |
| density | Event density — scales pulse frequencies of hats/stabs/grains together | 0.0–1.0 |
| haze | Mix of hiss + reverb wetness | 0.0–1.0 |
| grain | Granular layer presence | 0.0–1.0 |

These are starting points — we'll add/remove as we experiment.

### Browser UI

Extend the existing musicbox-web page:
- Experiment selector (dropdown or tabs) — defaults to new experiment
- Knob controls (range sliders or canvas-drawn knobs) that call `set_param` on the WASM engine
- Keep the sigil visualisation, adapt it to respond to the new engine's audio
- The original MusicBox drone remains available as a selectable experiment

### WASM bridge

`musicbox-web/src/lib.rs` gains a dispatcher that can instantiate different engines based on a name/ID. The AudioWorklet calls `render()` on whichever engine is active.

### Deployment

Ships to `musicbox.studio.internal` via existing aurelia service. Static files + WASM, no server-side changes needed. Build WASM, copy to `www/`, `aurelia deploy musicbox-web`.

### MCP dev tooling (deferred)

A Go-based MCP server (stdio transport) that bridges Claude Code to the running browser page via WebSocket. Lets Claude drive parameters programmatically. Not part of the first build — we'll add this once the audio engine and knobs are working.

## Implementation Plan

### Step 1: Extract DSP primitives

Make existing components in `musicbox-core/src/lib.rs` reusable:
- Create `src/dsp.rs` module with all primitives (`pub` visibility)
- `lib.rs` imports from `dsp` — original `MusicBox` unchanged
- All existing tests pass

### Step 2: Build the kick + pulse oscillator

- Pulse oscillator: sub-Hz phase accumulator that emits a trigger each cycle
- Kick synth: pitched sine with exponential pitch envelope + soft clip
- Minimal test engine: just a kick pulsing at ~2.08 Hz, verify in browser

### Step 3: Add drifting elements

- Noise generator + hi-hat (band-passed noise burst, pulse freq ~2x kick)
- Hiss layer (filtered noise, always-on texture)
- Each element has its own pulse oscillator — free-running, not locked to kick

### Step 4: Dub stabs + granular

- Dub stab voice: detuned chord, filtered, reverb send, pulse freq ~0.5x kick
- Granular engine: simple grain cloud from generated source
- Both with independent drifting pulse frequencies

### Step 5: Macro knobs + param system

- `set_param` / `get_params` API on the engine
- Wire up browser UI controls (sliders)
- Experiment selector in the UI

### Step 6: Ship

- Build WASM, update www/
- `aurelia deploy musicbox-web`
- Verify at musicbox.studio.internal
