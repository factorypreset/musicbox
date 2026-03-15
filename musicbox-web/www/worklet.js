// AudioWorkletProcessor that drives the musicbox WASM engine.
// Receives WASM module bytes from the main thread, instantiates synchronously.

// These will be populated when we receive the WASM module from main thread.
let wasm = null;
let MusicBoxWeb = null;

class MusicBoxProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.engine = null;
        this.done = false;

        this.port.onmessage = (event) => {
            const { type, data } = event.data;

            if (type === "init") {
                // Receive compiled WASM module and initialize synchronously
                const { wasmModule, sampleRate, seed } = data;
                // Import the bindings inline — we need initSync and MusicBoxWeb
                // Since we can't use ES modules in worklets, we use the compiled module directly
                this._initWasm(wasmModule, sampleRate, seed);
            } else if (type === "fade-out") {
                if (this.engine) {
                    this.engine.start_fade_out();
                }
            }
        };
    }

    _initWasm(wasmModule, sampleRate, seed) {
        // Manually instantiate WASM in the worklet scope
        const imports = {
            "./musicbox_web_bg.js": {
                __wbg___wbindgen_throw_6ddd609b62940d55: function (arg0, arg1) {
                    // We can't easily decode the string here, but throwing is fine
                    throw new Error("wasm error");
                },
                __wbindgen_init_externref_table: function () {
                    const table = instance.exports.__wbindgen_externrefs;
                    const offset = table.grow(4);
                    table.set(0, undefined);
                    table.set(offset + 0, undefined);
                    table.set(offset + 1, null);
                    table.set(offset + 2, true);
                    table.set(offset + 3, false);
                },
            },
        };

        const instance = new WebAssembly.Instance(wasmModule, imports);
        const exports = instance.exports;
        exports.__wbindgen_start();

        // Store exports for use in process()
        this._wasm = exports;
        this._memory = exports.memory;

        // Create the engine using the raw WASM exports
        const ptr = exports.musicboxweb_new(sampleRate, BigInt(seed));
        this.engine = { ptr };

        this.port.postMessage({ type: "ready" });
    }

    process(inputs, outputs, parameters) {
        if (!this.engine || this.done) {
            // Output silence until initialized, or after done
            return !this.done;
        }

        const output = outputs[0];
        if (!output || output.length === 0) return true;

        const frames = output[0].length; // typically 128

        // Call WASM render — returns [pointer, length] via multi-value
        const ret = this._wasm.musicboxweb_render(this.engine.ptr, frames);
        // ret is a pointer to a two-element array [ptr, len] — wasm-bindgen convention
        // Actually, ret is an array-like with ret[0]=ptr, ret[1]=len
        const dataPtr = ret[0];
        const dataLen = ret[1];

        // Read interleaved samples from WASM memory
        const interleaved = new Float32Array(
            this._memory.buffer,
            dataPtr,
            dataLen
        );

        // De-interleave into output channels
        const left = output[0];
        const right = output.length > 1 ? output[1] : null;

        for (let i = 0; i < frames; i++) {
            left[i] = interleaved[i * 2];
            if (right) {
                right[i] = interleaved[i * 2 + 1];
            }
        }

        // Free the WASM allocation
        this._wasm.__wbindgen_free(dataPtr, dataLen * 4, 4);

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
