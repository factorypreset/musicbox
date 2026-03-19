// AudioWorkletProcessor that drives WASM engines.
// Supports multiple engine types: "musicbox" (original) and "ambient-techno" (experiment).

class MusicBoxProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.engine = null;
        this.engineType = null;
        this.done = false;

        this.port.onmessage = (event) => {
            const { type, data } = event.data;

            if (type === "init") {
                try {
                    this._initWasm(data.wasmBytes, data.sampleRate, data.seedHigh, data.seedLow, data.engineType || "musicbox");
                } catch (err) {
                    this.port.postMessage({ type: "error", message: err.message || String(err) });
                }
            } else if (type === "fade-out") {
                if (this.engine) {
                    const fn = this.engineType === "ambient-techno"
                        ? this._wasm.ambienttechnoweb_start_fade_out
                        : this._wasm.musicboxweb_start_fade_out;
                    fn(this.engine.ptr);
                }
            } else if (type === "set-param") {
                if (this.engine && this.engineType === "ambient-techno") {
                    // Allocate param name string in WASM memory
                    const name = data.name;
                    const value = data.value;
                    const encoder = new TextEncoder();
                    const nameBytes = encoder.encode(name);
                    const namePtr = this._wasm.__wbindgen_malloc(nameBytes.length, 1);
                    const mem = new Uint8Array(this._memory.buffer, namePtr, nameBytes.length);
                    mem.set(nameBytes);
                    this._wasm.ambienttechnoweb_set_param(this.engine.ptr, namePtr, nameBytes.length, value);
                }
            }
        };
    }

    _initWasm(wasmBytes, sampleRate, seedHigh, seedLow, engineType) {
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
        this.engineType = engineType;

        const seed = (BigInt(seedHigh >>> 0) << 32n) | BigInt(seedLow >>> 0);

        if (engineType === "ambient-techno") {
            const ptr = exports.ambienttechnoweb_new(sampleRate, seed);
            this.engine = { ptr };
        } else {
            const ptr = exports.musicboxweb_new(sampleRate, seed);
            this.engine = { ptr };
        }

        this.port.postMessage({ type: "ready" });
    }

    process(inputs, outputs, parameters) {
        if (!this.engine || this.done) {
            return !this.done;
        }

        const output = outputs[0];
        if (!output || output.length === 0) return true;

        const frames = output[0].length;
        const prefix = this.engineType === "ambient-techno" ? "ambienttechnoweb" : "musicboxweb";

        this._wasm[`${prefix}_render`](this.engine.ptr, frames);

        const dataPtr = this._wasm[`${prefix}_output_ptr`](this.engine.ptr) >>> 0;
        const dataLen = this._wasm[`${prefix}_output_len`](this.engine.ptr) >>> 0;

        if (!dataPtr || !dataLen) return true;

        const interleaved = new Float32Array(this._memory.buffer, dataPtr, dataLen);

        const left = output[0];
        const right = output.length > 1 ? output[1] : null;

        for (let i = 0; i < frames; i++) {
            left[i] = interleaved[i * 2];
            if (right) {
                right[i] = interleaved[i * 2 + 1];
            }
        }

        if (this._wasm[`${prefix}_is_done`](this.engine.ptr) !== 0) {
            this.done = true;
            this.port.postMessage({ type: "done" });
            return false;
        }

        return true;
    }
}

registerProcessor("musicbox-processor", MusicBoxProcessor);
