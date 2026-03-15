// AudioWorkletProcessor that drives the musicbox WASM engine.
// Compiles WASM from raw bytes (Safari can't postMessage compiled modules).
// All WASM calls return single values (no multi-value — Safari compatible).

class MusicBoxProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.engine = null;
        this.done = false;

        this.port.onmessage = (event) => {
            const { type, data } = event.data;

            if (type === "init") {
                try {
                    this._initWasm(data.wasmBytes, data.sampleRate, data.seedHigh, data.seedLow);
                } catch (err) {
                    this.port.postMessage({ type: "error", message: err.message || String(err) });
                }
            } else if (type === "fade-out") {
                if (this.engine) {
                    this._wasm.musicboxweb_start_fade_out(this.engine.ptr);
                }
            }
        };
    }

    _initWasm(wasmBytes, sampleRate, seedHigh, seedLow) {
        const wasmModule = new WebAssembly.Module(wasmBytes);

        let instance;
        const imports = {
            "./musicbox_web_bg.js": {
                __wbg___wbindgen_throw_6ddd609b62940d55: function () {
                    throw new Error("wasm error");
                },
                __wbindgen_init_externref_table: function () {
                    const table = instance.exports.__wbindgen_externrefs;
                    if (table) {
                        const offset = table.grow(4);
                        table.set(0, undefined);
                        table.set(offset + 0, undefined);
                        table.set(offset + 1, null);
                        table.set(offset + 2, true);
                        table.set(offset + 3, false);
                    }
                },
            },
        };

        instance = new WebAssembly.Instance(wasmModule, imports);
        const exports = instance.exports;

        if (exports.__wbindgen_start) {
            exports.__wbindgen_start();
        }

        this._wasm = exports;
        this._memory = exports.memory;

        // Combine two 32-bit halves into a BigInt seed
        const seed = (BigInt(seedHigh >>> 0) << 32n) | BigInt(seedLow >>> 0);
        const ptr = exports.musicboxweb_new(sampleRate, seed);
        this.engine = { ptr };

        this.port.postMessage({ type: "ready" });
    }

    process(inputs, outputs, parameters) {
        if (!this.engine || this.done) {
            return !this.done;
        }

        const output = outputs[0];
        if (!output || output.length === 0) return true;

        const frames = output[0].length;

        // Render into the engine's internal buffer
        this._wasm.musicboxweb_render(this.engine.ptr, frames);

        // Read pointer and length (single-value returns, Safari safe)
        const dataPtr = this._wasm.musicboxweb_output_ptr(this.engine.ptr) >>> 0;
        const dataLen = this._wasm.musicboxweb_output_len(this.engine.ptr) >>> 0;

        if (!dataPtr || !dataLen) return true;

        // Read interleaved samples directly from WASM memory
        const interleaved = new Float32Array(this._memory.buffer, dataPtr, dataLen);

        const left = output[0];
        const right = output.length > 1 ? output[1] : null;

        for (let i = 0; i < frames; i++) {
            left[i] = interleaved[i * 2];
            if (right) {
                right[i] = interleaved[i * 2 + 1];
            }
        }

        // Check if engine is done
        if (this._wasm.musicboxweb_is_done(this.engine.ptr) !== 0) {
            this.done = true;
            this.port.postMessage({ type: "done" });
            return false;
        }

        return true;
    }
}

registerProcessor("musicbox-processor", MusicBoxProcessor);
