// ── Orbital Groovebox ──
// Concentric orbit rings representing polyrhythmic ratios.
// Voice sigils can be dragged onto rings to activate, or back to dock to mute.

const ORBITS = [
  { label: '1/1',  hz: 1.2,    radius: 160 },
  { label: '7/4',  hz: 2.1,    radius: 128 },
  { label: '3/5',  hz: 0.72,   radius: 96 },
  { label: '9/5',  hz: 2.16,   radius: 64 },
  { label: '1/7',  hz: 0.171,  radius: 32 },
];

const VOICES = [
  { id: 'kick',  param: 'kick_mute',  label: 'KCK' },
  { id: 'snare', param: 'snare_mute', label: 'SNR' },
  { id: 'hats',  param: 'hats_mute',  label: 'HAT' },
  { id: 'rim',   param: 'rim_mute',   label: 'RIM' },
  { id: 'stab1', param: 'stab1_mute', label: 'ST1' },
  { id: 'stab2', param: 'stab2_mute', label: 'ST2' },
  { id: 'stab3', param: 'stab3_mute', label: 'ST3' },
  { id: 'pad',   param: 'pad_mute',   label: 'PAD' },
  { id: 'mono',  param: 'mono_mute',  label: 'MNO' },
  { id: 'clave', param: 'clave_mute', label: 'CLV' },
  { id: 'bass',  param: 'bass_mute',  label: 'BAS' },
];

// Sigil SVG shapes — distinct geometric paths for each voice, drawn in a 28x28 viewBox
const SIGIL_PATHS = {
  kick:  'M14 2 A12 12 0 1 0 14 26 A12 12 0 1 0 14 2Z',                         // filled circle
  snare: 'M4 4 L24 24 M24 4 L4 24',                                              // X
  hats:  'M14 4 L24 24 L4 24 Z',                                                 // triangle
  rim:   'M14 4 L24 14 L14 24 L4 14 Z',                                          // diamond
  stab1: 'M6 6 H22 V22 H6 Z',                                                    // square
  stab2: 'M14 4 L24 14 L14 24 L4 14 Z',                                          // rotated square (diamond variant)
  stab3: 'M14 3 L25 11 L21 24 L7 24 L3 11 Z',                                    // pentagon
  pad:   'M4 14 H24 M4 14 A2 2 0 1 0 4 14.01 M24 14 A2 2 0 1 0 24 14.01',       // line with dots
  mono:  'M4 14 L8 6 L12 22 L16 6 L20 22 L24 14',                                // zigzag
  clave: 'M10 14 A4 4 0 1 0 10 14.01 M18 14 A4 4 0 1 0 18 14.01',               // two circles
  bass:  'M4 11 H24 V17 H4 Z',                                                   // thick bar
};

// Stroke vs fill for each sigil
const SIGIL_STYLE = {
  kick:  { fill: true },
  snare: { fill: false },
  hats:  { fill: false },
  rim:   { fill: false },
  stab1: { fill: false },
  stab2: { fill: true },
  stab3: { fill: false },
  pad:   { fill: false },
  mono:  { fill: false },
  clave: { fill: true },
  bass:  { fill: true },
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const CX = 200, CY = 200;
const SNAP_THRESHOLD = 24;
const SIGIL_SIZE = 28;

let placements = {}; // voiceId -> { ringIndex, phase }
let orbitAnimId = null;
let glowStates = {}; // voiceId -> { scale, startTime }

function initGroovebox() {
  const container = document.getElementById('groovebox');
  if (!container) return;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '400');
  svg.setAttribute('height', '400');
  svg.setAttribute('viewBox', '0 0 400 400');
  svg.style.touchAction = 'none';
  container.appendChild(svg);

  // Draw orbit rings
  ORBITS.forEach((orbit, i) => {
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', CX);
    circle.setAttribute('cy', CY);
    circle.setAttribute('r', orbit.radius);
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', 'var(--rule)');
    circle.setAttribute('stroke-width', '1');
    circle.classList.add('orbit-ring');
    circle.dataset.ringIndex = i;
    svg.appendChild(circle);

    // Ratio label
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', CX);
    text.setAttribute('y', CY - orbit.radius - 6);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', 'var(--muted)');
    text.setAttribute('font-size', '8');
    text.setAttribute('font-family', "'DM Sans', sans-serif");
    text.setAttribute('letter-spacing', '0.1em');
    text.textContent = orbit.label;
    svg.appendChild(text);

    // Trigger point marker at 12 o'clock
    const marker = document.createElementNS(SVG_NS, 'circle');
    marker.setAttribute('cx', CX);
    marker.setAttribute('cy', CY - orbit.radius);
    marker.setAttribute('r', '2');
    marker.setAttribute('fill', 'var(--muted)');
    marker.setAttribute('opacity', '0.4');
    svg.appendChild(marker);
  });

  // Create sigil groups (initially in dock)
  VOICES.forEach(voice => {
    const g = document.createElementNS(SVG_NS, 'g');
    g.classList.add('sigil-voice');
    g.dataset.voiceId = voice.id;
    g.style.cursor = 'grab';

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', SIGIL_PATHS[voice.id]);
    const style = SIGIL_STYLE[voice.id];
    if (style.fill) {
      path.setAttribute('fill', 'var(--ink)');
      path.setAttribute('stroke', 'none');
    } else {
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'var(--ink)');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
    }

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', SIGIL_SIZE / 2);
    label.setAttribute('y', SIGIL_SIZE + 10);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('fill', 'var(--muted)');
    label.setAttribute('font-size', '7');
    label.setAttribute('font-family', "'DM Sans', sans-serif");
    label.setAttribute('letter-spacing', '0.1em');
    label.textContent = voice.label;

    g.appendChild(path);
    g.appendChild(label);
    svg.appendChild(g);

    setupDrag(g, svg);
  });

  positionDock(svg);
}

function getDockPosition(index) {
  const cols = 6;
  const row = Math.floor(index / cols);
  const col = index % cols;
  const startX = 28;
  const startY = CY + ORBITS[0].radius + 40;
  return {
    x: startX + col * 60,
    y: startY + row * 50,
  };
}

function positionDock(svg) {
  const sigils = svg.querySelectorAll('.sigil-voice');
  sigils.forEach((g, i) => {
    const voiceId = g.dataset.voiceId;
    if (!placements[voiceId]) {
      const pos = getDockPosition(i);
      g.setAttribute('transform', `translate(${pos.x - SIGIL_SIZE/2}, ${pos.y - SIGIL_SIZE/2})`);
    }
  });
}

function setupDrag(g, svg) {
  let dragging = false;
  let offsetX = 0, offsetY = 0;
  let currentX = 0, currentY = 0;

  function getPointerPos(e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: svgP.x, y: svgP.y };
  }

  function onDown(e) {
    e.preventDefault();
    dragging = true;
    g.style.cursor = 'grabbing';
    const pos = getPointerPos(e);
    const transform = g.getAttribute('transform');
    const match = transform && transform.match(/translate\(([\d.-]+),\s*([\d.-]+)\)/);
    if (match) {
      currentX = parseFloat(match[1]);
      currentY = parseFloat(match[2]);
    }
    offsetX = pos.x - currentX - SIGIL_SIZE/2;
    offsetY = pos.y - currentY - SIGIL_SIZE/2;
    // Bring to front
    g.parentNode.appendChild(g);
    g.setPointerCapture(e.pointerId);
  }

  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const pos = getPointerPos(e);
    currentX = pos.x - offsetX - SIGIL_SIZE/2;
    currentY = pos.y - offsetY - SIGIL_SIZE/2;
    g.setAttribute('transform', `translate(${currentX}, ${currentY})`);
  }

  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    g.style.cursor = 'grab';

    const voiceId = g.dataset.voiceId;
    const centerX = currentX + SIGIL_SIZE/2;
    const centerY = currentY + SIGIL_SIZE/2;
    const dist = Math.sqrt((centerX - CX) ** 2 + (centerY - CY) ** 2);

    // Find nearest ring
    let nearestRing = -1;
    let nearestDist = Infinity;
    ORBITS.forEach((orbit, i) => {
      const d = Math.abs(dist - orbit.radius);
      if (d < nearestDist) {
        nearestDist = d;
        nearestRing = i;
      }
    });

    if (nearestDist < SNAP_THRESHOLD && nearestRing >= 0) {
      // Snap to ring
      const angle = Math.atan2(centerY - CY, centerX - CX);
      placements[voiceId] = { ringIndex: nearestRing, phase: angle };
      snapToRing(g, nearestRing, angle);
      onVoiceActivated(voiceId);
    } else {
      // Return to dock
      delete placements[voiceId];
      const idx = VOICES.findIndex(v => v.id === voiceId);
      const pos = getDockPosition(idx);
      g.setAttribute('transform', `translate(${pos.x - SIGIL_SIZE/2}, ${pos.y - SIGIL_SIZE/2})`);
      onVoiceDeactivated(voiceId);
    }
  }

  g.addEventListener('pointerdown', onDown);
  g.addEventListener('pointermove', onMove);
  g.addEventListener('pointerup', onUp);
  g.addEventListener('pointercancel', onUp);
}

function snapToRing(g, ringIndex, angle) {
  const orbit = ORBITS[ringIndex];
  const x = CX + orbit.radius * Math.cos(angle) - SIGIL_SIZE/2;
  const y = CY + orbit.radius * Math.sin(angle) - SIGIL_SIZE/2;
  g.setAttribute('transform', `translate(${x}, ${y})`);
}

// ── Audio integration hooks (wired up in step 3) ──

function onVoiceActivated(voiceId) {
  if (typeof window.grooveboxOnVoice === 'function') {
    window.grooveboxOnVoice(voiceId, true);
  }
}

function onVoiceDeactivated(voiceId) {
  if (typeof window.grooveboxOnVoice === 'function') {
    window.grooveboxOnVoice(voiceId, false);
  }
}

// ── Orbit animation ──

function startOrbitAnimation() {
  let lastTime = performance.now();

  function animate(now) {
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    const svg = document.querySelector('#groovebox svg');
    if (!svg) return;

    // Recalculate spacing for sigils on each ring
    const ringOccupants = {};
    for (const [voiceId, p] of Object.entries(placements)) {
      if (!ringOccupants[p.ringIndex]) ringOccupants[p.ringIndex] = [];
      ringOccupants[p.ringIndex].push(voiceId);
    }

    // Evenly space sigils on each ring
    for (const [ringIdx, voices] of Object.entries(ringOccupants)) {
      const spacing = (2 * Math.PI) / voices.length;
      voices.forEach((voiceId, i) => {
        const p = placements[voiceId];
        // Assign evenly-spaced base offsets, then advance all by orbit speed
        if (p._baseOffset === undefined) {
          p._baseOffset = i * spacing;
        }
      });
    }

    for (const [voiceId, p] of Object.entries(placements)) {
      const orbit = ORBITS[p.ringIndex];
      p.phase += orbit.hz * dt * 2 * Math.PI;
      // Wrap
      if (p.phase > Math.PI) p.phase -= 2 * Math.PI;
      if (p.phase < -Math.PI) p.phase += 2 * Math.PI;

      const g = svg.querySelector(`[data-voice-id="${voiceId}"]`);
      if (!g) continue;

      // Glow: check if crossing trigger point (top = -PI/2)
      const triggerAngle = -Math.PI / 2;
      const prevPhase = p.phase - orbit.hz * dt * 2 * Math.PI;
      const crossed = (prevPhase < triggerAngle && p.phase >= triggerAngle) ||
                       (prevPhase > 0 && p.phase < 0 && triggerAngle < 0 && prevPhase > Math.PI / 2);
      if (crossed) {
        glowStates[voiceId] = { startTime: now };
      }

      // Apply glow
      let scale = 1;
      if (glowStates[voiceId]) {
        const elapsed = now - glowStates[voiceId].startTime;
        if (elapsed < 200) {
          scale = 1 + 0.3 * (1 - elapsed / 200);
        } else {
          delete glowStates[voiceId];
        }
      }

      const x = CX + orbit.radius * Math.cos(p.phase);
      const y = CY + orbit.radius * Math.sin(p.phase);
      if (scale !== 1) {
        g.setAttribute('transform',
          `translate(${x - SIGIL_SIZE/2}, ${y - SIGIL_SIZE/2}) ` +
          `translate(${SIGIL_SIZE/2}, ${SIGIL_SIZE/2}) scale(${scale}) translate(${-SIGIL_SIZE/2}, ${-SIGIL_SIZE/2})`);
        g.style.opacity = Math.min(1, 0.7 + scale * 0.3);
      } else {
        g.setAttribute('transform', `translate(${x - SIGIL_SIZE/2}, ${y - SIGIL_SIZE/2})`);
        g.style.opacity = '1';
      }
    }

    orbitAnimId = requestAnimationFrame(animate);
  }

  orbitAnimId = requestAnimationFrame(animate);
}

function stopOrbitAnimation() {
  if (orbitAnimId) {
    cancelAnimationFrame(orbitAnimId);
    orbitAnimId = null;
  }
}

// Export for main.js
window.groovebox = {
  init: initGroovebox,
  startAnimation: startOrbitAnimation,
  stopAnimation: stopOrbitAnimation,
  getPlacements: () => placements,
  VOICES,
};
