let audioCtx = null;
let workletNode = null;
let wasmModule = null;

const btn = document.getElementById("toggle");
const status = document.getElementById("status");

function setStatus(text) {
    status.textContent = text;
}

async function loadWasm() {
    if (wasmModule) return wasmModule;
    setStatus("Loading WASM...");
    const response = await fetch("pkg/musicbox_web_bg.wasm");
    const bytes = await response.arrayBuffer();
    wasmModule = await WebAssembly.compile(bytes);
    return wasmModule;
}

async function start() {
    btn.disabled = true;
    setStatus("Starting...");

    try {
        const module = await loadWasm();

        audioCtx = new AudioContext({ sampleRate: 44100 });
        await audioCtx.audioWorklet.addModule("worklet.js");

        workletNode = new AudioWorkletNode(audioCtx, "musicbox-processor", {
            outputChannelCount: [2],
        });

        workletNode.connect(audioCtx.destination);

        // Wait for worklet to signal ready
        const ready = new Promise((resolve) => {
            workletNode.port.onmessage = (event) => {
                if (event.data.type === "ready") {
                    resolve();
                } else if (event.data.type === "done") {
                    setStatus("Stopped.");
                    btn.textContent = "Play";
                    btn.disabled = false;
                    cleanup();
                }
            };
        });

        // Generate a random seed
        const seed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);

        // Send WASM module to worklet for synchronous instantiation
        workletNode.port.postMessage({
            type: "init",
            data: {
                wasmModule: module,
                sampleRate: audioCtx.sampleRate,
                seed,
            },
        });

        await ready;

        // Re-attach message handler for done events
        workletNode.port.onmessage = (event) => {
            if (event.data.type === "done") {
                setStatus("Stopped.");
                btn.textContent = "Play";
                btn.disabled = false;
                cleanup();
            }
        };

        setStatus("Playing...");
        btn.textContent = "Stop";
        btn.disabled = false;
    } catch (err) {
        setStatus("Error: " + err.message);
        btn.disabled = false;
        console.error(err);
    }
}

function stop() {
    if (workletNode) {
        setStatus("Fading out...");
        btn.disabled = true;
        workletNode.port.postMessage({ type: "fade-out" });
    }
}

function cleanup() {
    if (workletNode) {
        workletNode.disconnect();
        workletNode = null;
    }
    if (audioCtx) {
        audioCtx.close();
        audioCtx = null;
    }
}

btn.addEventListener("click", () => {
    if (audioCtx && audioCtx.state !== "closed") {
        stop();
    } else {
        start();
    }
});
