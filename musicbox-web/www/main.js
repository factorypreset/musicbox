let audioCtx = null;
let workletNode = null;
let wasmBytes = null;

const btn = document.getElementById("toggle");
const status = document.getElementById("status");

function setStatus(text) {
    status.textContent = text;
}

async function loadWasm() {
    if (wasmBytes) return wasmBytes;
    setStatus("Loading WASM...");
    const response = await fetch("pkg/musicbox_web_bg.wasm");
    wasmBytes = await response.arrayBuffer();
    return wasmBytes;
}

async function start() {
    btn.disabled = true;
    setStatus("Starting...");

    try {
        const bytes = await loadWasm();

        audioCtx = new AudioContext({ sampleRate: 44100 });
        await audioCtx.audioWorklet.addModule("worklet.js");

        workletNode = new AudioWorkletNode(audioCtx, "musicbox-processor", {
            outputChannelCount: [2],
        });

        workletNode.connect(audioCtx.destination);

        // Wait for worklet to signal ready
        const ready = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Worklet init timed out")), 10000);
            workletNode.port.onmessage = (event) => {
                if (event.data.type === "ready") {
                    clearTimeout(timeout);
                    resolve();
                } else if (event.data.type === "error") {
                    clearTimeout(timeout);
                    reject(new Error(event.data.message));
                } else if (event.data.type === "done") {
                    setStatus("Stopped.");
                    btn.textContent = "Play";
                    btn.disabled = false;
                    cleanup();
                }
            };
        });

        // Generate a random seed as two 32-bit halves (avoids BigInt compatibility issues)
        const seedHigh = Math.floor(Math.random() * 0xFFFFFFFF);
        const seedLow = Math.floor(Math.random() * 0xFFFFFFFF);

        // Send raw WASM bytes to worklet (Safari can't postMessage compiled modules)
        workletNode.port.postMessage({
            type: "init",
            data: {
                wasmBytes: bytes,
                sampleRate: audioCtx.sampleRate,
                seedHigh,
                seedLow,
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
