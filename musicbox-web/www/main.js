let audioCtx = null;
let workletNode = null;
let analyser = null;
let wasmBytes = null;
let animFrameId = null;

const btn = document.getElementById("toggle");
const status = document.getElementById("status");

// Static path data for morph-back
const SINE_PATH = "M 40 120 C 40 120, 50 74, 60 74 C 70 74, 80 120, 80 120 C 80 120, 90 166, 100 166 C 110 166, 120 120, 120 120 C 120 120, 130 74, 140 74 C 150 74, 160 120, 160 120 C 160 120, 170 166, 180 166 C 190 166, 200 120, 200 120";
const NOISE_PATH = "M 40 120 L 48 89 L 56 145 L 62 78 L 70 153 L 78 95 L 88 162 L 96 83 L 104 148 L 112 74 L 118 139 L 126 92 L 134 166 L 140 80 L 150 151 L 158 90 L 164 133 L 172 74 L 182 146 L 190 98 L 200 120";

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

// Build an SVG path string from time-domain audio data
function buildWaveformPath(dataArray, bufferLength) {
    const xMin = 40, xMax = 200;
    const yCenter = 120, yRange = 80;
    const step = bufferLength / 20; // sample ~20 points for a smooth path

    let d = "";
    for (let i = 0; i <= 20; i++) {
        const idx = Math.min(Math.floor(i * step), bufferLength - 1);
        const sample = (dataArray[idx] / 128.0) - 1.0; // normalize to [-1, 1]
        const x = xMin + (i / 20) * (xMax - xMin);
        const y = yCenter - sample * yRange;
        d += (i === 0 ? "M " : " L ") + x.toFixed(1) + " " + y.toFixed(1);
    }
    return d;
}

function startVisualization() {
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    function draw() {
        animFrameId = requestAnimationFrame(draw);
        analyser.getByteTimeDomainData(dataArray);

        const path = buildWaveformPath(dataArray, dataArray.length);

        // Update whichever sigil face(s) exist — both get live data
        const frontPath = document.getElementById("sigil-wave-front");
        const backPath = document.getElementById("sigil-wave-back");
        if (frontPath) frontPath.setAttribute("d", path);
        if (backPath) backPath.setAttribute("d", path);
    }

    draw();
}

function stopVisualization() {
    if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
    }

    // Morph back to static shapes
    const frontPath = document.getElementById("sigil-wave-front");
    const backPath = document.getElementById("sigil-wave-back");
    if (frontPath) frontPath.setAttribute("d", SINE_PATH);
    if (backPath) backPath.setAttribute("d", NOISE_PATH);
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

        // Insert analyser between worklet and destination
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        workletNode.connect(analyser);
        analyser.connect(audioCtx.destination);

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

        // Start the sigil visualization
        startVisualization();

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
    stopVisualization();
    if (workletNode) {
        workletNode.disconnect();
        workletNode = null;
    }
    if (analyser) {
        analyser.disconnect();
        analyser = null;
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
