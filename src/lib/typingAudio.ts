/**
 * Web Audio API synthesizer for tactile mechanical keyboard typing sounds.
 * Generates crisp, zero-latency mechanical key clicks without external audio files.
 */

export type SwitchType = 'tactile' | 'clicky' | 'thock' | 'typewriter';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    void audioCtx.resume();
  }
  return audioCtx;
}

export function playTypingSound(
  key?: string,
  volumeMultiplier = 0.6,
  switchType: SwitchType = 'tactile'
) {
  if (volumeMultiplier <= 0) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const isSpace = key === ' ';
    const isBackspace = key === 'Backspace';
    const isEnter = key === 'Enter';

    // Organic pitch jitter like real mechanical switches
    const pitchJitter = 0.94 + Math.random() * 0.12;

    let baseFreq = 520;
    let clickFreq = 1850;
    let decayTime = 0.028;
    let noiseFilterFreq = 3600;
    let noiseGainVal = 0.065;
    let oscType: OscillatorType = 'sine';

    switch (switchType) {
      case 'clicky': // Sharp Blue switch
        baseFreq = isSpace ? 380 : isEnter ? 460 : isBackspace ? 520 : (640 + Math.random() * 160);
        clickFreq = 2600;
        noiseFilterFreq = 4800;
        noiseGainVal = 0.09;
        decayTime = 0.022;
        break;
      case 'thock': // Deep creamy linear/tactile (Boba / Cream)
        baseFreq = isSpace ? 190 : isEnter ? 240 : isBackspace ? 270 : (310 + Math.random() * 70);
        clickFreq = 950;
        noiseFilterFreq = 1800;
        noiseGainVal = 0.04;
        decayTime = 0.042;
        oscType = 'triangle';
        break;
      case 'typewriter': // Heavy mechanical clack with metallic edge
        baseFreq = isSpace ? 280 : isEnter ? 320 : isBackspace ? 390 : (460 + Math.random() * 120);
        clickFreq = 2200;
        noiseFilterFreq = 2800;
        noiseGainVal = 0.11;
        decayTime = 0.048;
        oscType = 'sawtooth';
        break;
      case 'tactile':
      default: // Cherry Brown / Holy Panda
        baseFreq = isSpace ? 320 : isEnter ? 380 : isBackspace ? 440 : (520 + Math.random() * 140);
        clickFreq = 1850;
        noiseFilterFreq = 3600;
        noiseGainVal = 0.065;
        decayTime = isSpace ? 0.045 : 0.028;
        oscType = isSpace ? 'triangle' : 'sine';
        break;
    }

    // 1. Resonant click tone
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = oscType;
    osc.frequency.setValueAtTime(baseFreq * pitchJitter, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(50, baseFreq * 0.35), now + decayTime);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime((isSpace ? clickFreq * 0.5 : clickFreq) * pitchJitter, now);
    filter.Q.setValueAtTime(isSpace ? 3.5 : 5.5, now);

    const baseVol = (isSpace ? 0.09 : isEnter ? 0.11 : 0.075) * volumeMultiplier;
    oscGain.gain.setValueAtTime(baseVol, now);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + decayTime);

    osc.connect(filter);
    filter.connect(oscGain);
    oscGain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + decayTime + 0.02);

    // 2. High-frequency transient switch click
    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * 0.007)); // ~7ms
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.28));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.setValueAtTime((isSpace ? noiseFilterFreq * 0.6 : noiseFilterFreq) * pitchJitter, now);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime((isSpace ? noiseGainVal * 0.8 : noiseGainVal) * volumeMultiplier, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.007);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    noise.start(now);
  } catch {
    // Ignore audio policy or suspended context errors
  }
}
