# musicbox v0.1.0

Generative ambient audio written in Rust. Each run sounds different.

Layered pentatonic drones, resonant filter sweeps, Karplus-Strong plucks
through BBD delay, and a Dattorro plate reverb.

## Listen

```
cargo run --release
```

Ctrl+C to fade out and stop.

## Render to file

```
cargo run --release -- --render 10m output.wav
```

Renders a 32-bit float stereo WAV. Duration examples: `10m`, `1h30m`, `90s`, `5m30s`.

## What you'll hear

- **Bass:** Sine drones fading in and out across A minor pentatonic
- **Mids:** Oscillator layers through a sweeping resonant low-pass filter
- **High-mids:** Plucked notes through a BBD (bucket brigade) delay
- **Highs:** Oscillators through a Dattorro plate reverb (ported from Mutable Instruments Clouds)
- **Master:** Peak limiter, 3-second fade-in/out

## Requirements

- [Rust](https://rustup.rs/) (stable)
- An audio output device (for live playback)

## License

[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) — Ben Askins, 2026
