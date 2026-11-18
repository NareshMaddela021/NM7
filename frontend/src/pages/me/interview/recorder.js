// Vetting Trust T10: records the spoken answer for the pronunciation provider while the browser listens (only when the
// interview measures spoken English and a provider is set). The sound stays in this tab's memory as samples; when the
// answer is sent it becomes one short WAV clip (16 kHz mono, at most 20 seconds) that goes to Nm7 and on to the provider,
// and is then dropped. Nothing is recorded when the microphone can't be opened a second time (then pronunciation is
// simply "not measured"). In the interview runner's chunk only.
import { CLIP_SECONDS, downsample, toBase64, wavBytes } from '../trust/spokenLib';

export function createRecorder() {
  let ctx = null; let src = null; let node = null; let stream = null;
  let chunks = []; let total = 0; let on = false; let rate = 48000; let failed = false;
  const max = () => rate * CLIP_SECONDS;
  const open = async () => {
    if (ctx || failed) return !!ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC || !navigator.mediaDevices?.getUserMedia) throw new Error('no audio');
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      ctx = new AC();
      rate = ctx.sampleRate;
      src = ctx.createMediaStreamSource(stream);
      node = ctx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (e) => {
        if (!on || total >= max()) return;
        const d = e.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(d)); total += d.length;
      };
      src.connect(node); node.connect(ctx.destination);
      return true;
    } catch { failed = true; return false; }
  };
  return {
    async start() { if (await open()) { on = true; ctx.resume?.(); } },
    pause() { on = false; },
    /** The clip so far as base64 WAV ('' when nothing was heard), and a fresh start for the next answer. */
    take() {
      on = false;
      if (!total) return '';
      const all = new Float32Array(total); let o = 0;
      for (const c of chunks) { all.set(c, o); o += c.length; }
      chunks = []; total = 0;
      return toBase64(wavBytes(downsample(all, rate)));
    },
    close() {
      on = false; chunks = []; total = 0;
      try { node?.disconnect(); src?.disconnect(); stream?.getTracks().forEach((t) => t.stop()); ctx?.close(); } catch { /* closed */ }
      ctx = null;
    },
  };
}
