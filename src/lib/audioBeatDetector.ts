/**
 * Audio Beat, Onset & Silence Detector.
 * Analyzes audio waveforms to detect real-world BPM, onsets, audible start offset, and energy drops.
 */

export interface AudioAnalysisResult {
  bpm: number;
  beatInterval: number; // in seconds
  firstBeatOffset: number; // in seconds
  firstAudibleOffset: number; // in seconds (skips initial silence)
  onsets: number[]; // array of exact onset timestamps in seconds
  duration: number;
  dropRanges: Array<{ start: number; end: number }>;
}

/**
 * Downsamples and calculates energy envelope across frames.
 */
function computeEnergyEnvelopes(
  channelData: Float32Array,
  sampleRate: number,
  hopSize = 512
): { times: number[]; bassFlux: Float32Array; midFlux: Float32Array; bassEnergies: Float32Array } {
  const numFrames = Math.floor(channelData.length / hopSize);
  const times: number[] = new Array(numFrames);
  const bassFlux = new Float32Array(numFrames);
  const midFlux = new Float32Array(numFrames);
  const bassEnergies = new Float32Array(numFrames);

  let prevBassEnergy = 0;
  let prevMidEnergy = 0;

  // Single-pole low-pass filter coefficient for ~200Hz
  const alpha = Math.exp((-2 * Math.PI * 200) / sampleRate);

  for (let frame = 0; frame < numFrames; frame++) {
    const start = frame * hopSize;
    times[frame] = start / sampleRate;

    let bassEnergy = 0;
    let midEnergy = 0;
    let lpState = 0;

    for (let i = 0; i < hopSize; i++) {
      const sample = channelData[start + i] || 0;
      lpState = alpha * lpState + (1 - alpha) * sample;
      const hp = sample - lpState;

      bassEnergy += lpState * lpState;
      midEnergy += hp * hp;
    }

    bassEnergy = Math.sqrt(bassEnergy / hopSize);
    midEnergy = Math.sqrt(midEnergy / hopSize);

    bassEnergies[frame] = bassEnergy;

    // Half-wave rectified flux
    bassFlux[frame] = Math.max(0, bassEnergy - prevBassEnergy);
    midFlux[frame] = Math.max(0, midEnergy - prevMidEnergy);

    prevBassEnergy = bassEnergy;
    prevMidEnergy = midEnergy;
  }

  return { times, bassFlux, midFlux, bassEnergies };
}

/**
 * Finds local peaks above dynamic threshold.
 */
function findOnsetPeaks(
  times: number[],
  flux: Float32Array,
  windowSize = 12,
  sensitivity = 1.25
): number[] {
  const onsets: number[] = [];
  const len = flux.length;

  for (let i = windowSize; i < len - windowSize; i++) {
    const val = flux[i];
    if (val <= 0.004) continue;

    let isMax = true;
    for (let w = -windowSize; w <= windowSize; w++) {
      if (w !== 0 && flux[i + w] > val) {
        isMax = false;
        break;
      }
    }
    if (!isMax) continue;

    let sum = 0;
    for (let w = -windowSize; w <= windowSize; w++) {
      sum += flux[i + w];
    }
    const localMean = sum / (windowSize * 2 + 1);

    if (val > localMean * sensitivity) {
      onsets.push(Number(times[i].toFixed(3)));
    }
  }

  return onsets;
}

/**
 * Estimates BPM from inter-onset intervals (IOI histogram).
 */
function estimateBpmFromOnsets(onsets: number[]): { bpm: number; beatInterval: number } {
  if (onsets.length < 4) {
    return { bpm: 130, beatInterval: 60 / 130 };
  }

  const intervalCounts: Map<number, number> = new Map();
  const bucketSize = 0.012; // 12ms resolution

  for (let i = 0; i < onsets.length; i++) {
    const limit = Math.min(onsets.length, i + 10);
    for (let j = i + 1; j < limit; j++) {
      const diff = onsets[j] - onsets[i];
      // Looking for intervals between 60 BPM (1.0s) and 200 BPM (0.3s)
      if (diff >= 0.25 && diff <= 1.05) {
        const bucket = Math.round(diff / bucketSize) * bucketSize;
        intervalCounts.set(bucket, (intervalCounts.get(bucket) || 0) + 1);
      }
    }
  }

  let bestInterval = 60 / 130;
  let maxCount = 0;

  for (const [interval, count] of intervalCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      bestInterval = interval;
    }
  }

  let bpm = Math.round(60 / bestInterval);

  // Normalize BPM to realistic dance / techno / electronic range (110-175)
  while (bpm < 105) bpm *= 2;
  while (bpm > 185) bpm /= 2;

  const beatInterval = 60 / bpm;
  return { bpm, beatInterval };
}

/**
 * Finds the first major downbeat offset.
 */
function findFirstBeatOffset(onsets: number[], beatInterval: number): number {
  if (onsets.length === 0) return 0.1;

  const earlyOnsets = onsets.filter((t) => t >= 0.05 && t <= 8.0);
  if (earlyOnsets.length === 0) return onsets[0] || 0.1;

  let first = earlyOnsets[0];
  first = Number((first % beatInterval).toFixed(3));
  if (first < 0.03) first += beatInterval;

  return first;
}

/**
 * Detects explosive drop ranges in the track by finding sustained high bass energy plateaus.
 */
function detectDropRanges(
  times: number[],
  bassEnergies: Float32Array,
  duration: number
): Array<{ start: number; end: number }> {
  const drops: Array<{ start: number; end: number }> = [];
  if (bassEnergies.length === 0 || duration < 30) {
    // Default structural EDM drops if too short
    return [
      { start: duration * 0.35, end: duration * 0.55 },
      { start: duration * 0.72, end: duration * 0.9 },
    ];
  }

  // Calculate moving average over 2-second windows
  const windowSecs = 2.0;
  const fps = Math.round(bassEnergies.length / duration);
  const winFrames = Math.max(1, Math.round(windowSecs * fps));

  const smoothed = new Float32Array(bassEnergies.length);
  let runSum = 0;

  for (let i = 0; i < bassEnergies.length; i++) {
    runSum += bassEnergies[i];
    if (i >= winFrames) runSum -= bassEnergies[i - winFrames];
    smoothed[i] = runSum / Math.min(i + 1, winFrames);
  }

  // Find mean and threshold
  let sum = 0;
  for (let i = 0; i < smoothed.length; i++) sum += smoothed[i];
  const meanEnergy = sum / smoothed.length;
  const dropThreshold = meanEnergy * 1.25;

  let inDrop = false;
  let dropStart = 0;

  for (let i = 0; i < smoothed.length; i++) {
    const t = times[i];
    const isHigh = smoothed[i] >= dropThreshold;

    if (isHigh && !inDrop) {
      inDrop = true;
      dropStart = t;
    } else if (!isHigh && inDrop) {
      inDrop = false;
      const dropLen = t - dropStart;
      if (dropLen >= 8.0) {
        drops.push({
          start: Number(dropStart.toFixed(2)),
          end: Number(t.toFixed(2)),
        });
      }
    }
  }

  if (inDrop && duration - dropStart >= 8.0) {
    drops.push({
      start: Number(dropStart.toFixed(2)),
      end: Number(duration.toFixed(2)),
    });
  }

  // Fallback if no specific drops detected
  if (drops.length === 0) {
    drops.push(
      { start: Number((duration * 0.35).toFixed(2)), end: Number((duration * 0.58).toFixed(2)) },
      { start: Number((duration * 0.72).toFixed(2)), end: Number((duration * 0.91).toFixed(2)) }
    );
  }

  return drops;
}

/**
 * Detects the first point in an AudioBuffer where sound is actually audible,
 * skipping silent intros, digital zeros, and low ambient noise.
 */
export function detectAudibleStart(buffer: AudioBuffer, threshold = 0.015): number {
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const windowSize = Math.max(256, Math.floor(sampleRate * 0.04)); // 40ms windows
  const len = channelData.length;

  for (let i = 0; i < len - windowSize; i += windowSize) {
    let sum = 0;
    for (let j = 0; j < windowSize; j++) {
      const s = channelData[i + j];
      sum += s * s;
    }
    const rms = Math.sqrt(sum / windowSize);
    if (rms >= threshold) {
      // Small lead-in cushion (60ms) so attack transients aren't truncated
      const t = Math.max(0, i / sampleRate - 0.06);
      return Number(t.toFixed(2));
    }
  }
  return 0;
}

/**
 * Analyzes an AudioBuffer and extracts real tempo, onsets, downbeats, drop ranges, and audible start.
 */
export function analyzeAudioBuffer(buffer: AudioBuffer): AudioAnalysisResult {
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const duration = buffer.duration;

  const { times, bassFlux, midFlux, bassEnergies } = computeEnergyEnvelopes(
    channelData,
    sampleRate,
    512
  );

  const bassOnsets = findOnsetPeaks(times, bassFlux, 10, 1.25);
  const midOnsets = findOnsetPeaks(times, midFlux, 8, 1.3);

  const allOnsetsSet = new Set<number>();
  for (const t of bassOnsets) allOnsetsSet.add(t);
  for (const t of midOnsets) allOnsetsSet.add(t);

  const onsets = Array.from(allOnsetsSet).sort((a, b) => a - b);

  const onsetPool = bassOnsets.length > 20 ? bassOnsets : onsets;
  const { bpm, beatInterval } = estimateBpmFromOnsets(onsetPool);
  const firstBeatOffset = findFirstBeatOffset(
    bassOnsets.length > 0 ? bassOnsets : onsets,
    beatInterval
  );

  let firstAudibleOffset = detectAudibleStart(buffer);
  // If first audible onset is earlier than RMS threshold or RMS found late silence
  if (onsets.length > 0 && onsets[0] > 0.05 && onsets[0] < firstAudibleOffset) {
    firstAudibleOffset = Math.max(0, onsets[0] - 0.05);
  }

  const dropRanges = detectDropRanges(times, bassEnergies, duration);

  return {
    bpm,
    beatInterval,
    firstBeatOffset,
    firstAudibleOffset,
    onsets,
    duration,
    dropRanges,
  };
}

/** Cache of decoded & analyzed audio tracks to avoid re-decoding on restart */
const analysisCache = new Map<string, AudioAnalysisResult>();

/**
 * Fetches and analyzes an audio URL.
 */
export async function analyzeTrackAudio(
  trackId: string,
  audioUrl: string
): Promise<AudioAnalysisResult | null> {
  const cached = analysisCache.get(trackId);
  if (cached) return cached;

  try {
    const res = await fetch(audioUrl, { mode: 'cors' });
    if (!res.ok) return null;

    const arrayBuffer = await res.arrayBuffer();
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;

    const offlineCtx = new Ctor();
    const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);
    void offlineCtx.close();

    const analysis = analyzeAudioBuffer(audioBuffer);
    analysisCache.set(trackId, analysis);
    return analysis;
  } catch (err) {
    console.warn('[BeatDetector] Failed to analyze audio buffer:', err);
    return null;
  }
}

/**
 * Quick helper to retrieve audible start offset for Song Guessr snippet playback,
 * ensuring moments of silence are skipped.
 */
export async function getAudibleStartTime(
  trackId: string,
  audioUrl: string,
  trackDuration?: number
): Promise<number> {
  try {
    const analysis = await analyzeTrackAudio(trackId, audioUrl);
    if (analysis && typeof analysis.firstAudibleOffset === 'number') {
      const maxAllowed = (trackDuration || analysis.duration || 180) - 15;
      return Math.min(Math.max(0, analysis.firstAudibleOffset), Math.max(0, maxAllowed));
    }
  } catch {
    /* ignore and use fallback */
  }
  return 0;
}
