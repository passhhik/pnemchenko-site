// Голос: mp3-реплики + открытие рта по громкости. Если записи нет — «бормотание» звуками.
const VOWELS = /[аеёиоуыэюяaeiou]/i;
export { VOWELS };

export class Voice {
  constructor({ head, base = 'assets/voice/' }) {
    this.head = head;
    this.base = base;
    this.available = new Set();
    this.enabled = false;
    this.ctx = null;
    this.current = null;
    this.flap = 0;
  }

  async init() {
    try {
      const r = await fetch(this.base + 'manifest.json', { cache: 'no-cache' });
      if (r.ok) this.available = new Set(await r.json());
    } catch (_) { /* нет манифеста — нет записей */ }
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (this.enabled) this.unlock(); else this.stop();
  }

  // AudioContext можно запустить только после действия пользователя
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.9;
      this.out.connect(this.ctx.destination);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.connect(this.out);
      this.buf = new Float32Array(this.analyser.fftSize);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  has(id) { return this.enabled && this.available.has(id); }

  async play(id) {
    this.stop();
    this.unlock();
    if (!this.ctx) return null;
    const el = new Audio(this.base + id + '.mp3');
    el.preload = 'auto';
    const src = this.ctx.createMediaElementSource(el);
    src.connect(this.analyser);
    const cur = { el, src, resolve: null };
    this.current = cur;
    const done = new Promise((res) => {
      cur.resolve = res;
      el.addEventListener('ended', res, { once: true });
      el.addEventListener('error', res, { once: true });
    }).then(() => { if (this.current === cur) this.current = null; });
    try { await el.play(); } catch (_) { cur.resolve(); return null; }
    if (!(el.duration > 0 && isFinite(el.duration))) {
      await new Promise((res) => el.addEventListener('loadedmetadata', res, { once: true }));
    }
    return { duration: el.duration, done };
  }

  stop() {
    const c = this.current;
    if (!c) return;
    this.current = null;
    try { c.el.pause(); c.src.disconnect(); } catch (_) { /* noop */ }
    if (c.resolve) c.resolve();
  }

  // вызывается на каждой гласной при печати текста
  vowel() {
    this.flap = 0.3 + Math.random() * 0.24;
    if (this.enabled && !this.current) this._blip();
  }

  _blip() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(150 + Math.random() * 90, t);
    o.frequency.exponentialRampToValueAtTime(105 + Math.random() * 40, t + 0.07);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g).connect(this.out);
    o.start(t); o.stop(t + 0.09);
  }

  boing(strength = 0.5) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime, s = Math.min(1, Math.max(0.1, strength));
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(90 + 120 * s, t);
    o.frequency.exponentialRampToValueAtTime(420 + 220 * s, t + 0.12);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.45);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1 * s + 0.02, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(this.out);
    o.start(t); o.stop(t + 0.52);
  }

  // белый шум — основа «мокрых» звуков
  _noise() {
    if (!this.noiseBuf) {
      const n = Math.floor(this.ctx.sampleRate * 0.4), buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    return src;
  }

  // плевок: короткое шипящее «тьфу» — шум через полосовой фильтр, частота быстро падает
  spit(strength = 0.6) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime, s = Math.min(1, Math.max(0.2, strength));
    const src = this._noise(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    f.type = 'bandpass'; f.Q.value = 0.9;
    f.frequency.setValueAtTime(3600, t);
    f.frequency.exponentialRampToValueAtTime(800, t + 0.15);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1 + 0.16 * s, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(f).connect(g).connect(this.out);
    src.start(t); src.stop(t + 0.2);
  }

  // шлепок о «стекло»: глухой удар и мокрый хвост
  splat(strength = 0.5) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime, s = Math.min(1, Math.max(0.2, strength));
    const o = this.ctx.createOscillator(), og = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.1 + 0.14 * s, t + 0.008);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(og).connect(this.out);
    o.start(t); o.stop(t + 0.13);
    const src = this._noise(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    f.type = 'lowpass'; f.frequency.setValueAtTime(1500, t); f.frequency.exponentialRampToValueAtTime(350, t + 0.16);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 + 0.1 * s, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    src.connect(f).connect(g).connect(this.out);
    src.start(t); src.stop(t + 0.22);
  }

  // отсчёт перед снимком: короткий «пик» (последний — выше)
  beep(high = false) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(high ? 1320 : 880, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g).connect(this.out);
    o.start(t); o.stop(t + 0.15);
  }

  // затвор полароида: сухой щелчок, глухой второй и жужжание моторчика, пока карточка выезжает
  shutter() {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const c = this.ctx, t = c.currentTime;
    const n = this._noise(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'highpass'; f.frequency.value = 1800;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(f).connect(g).connect(this.out);
    n.start(t); n.stop(t + 0.06);
    const o = c.createOscillator(), og = c.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(140, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.11);
    og.gain.setValueAtTime(0.0001, t + 0.07);
    og.gain.exponentialRampToValueAtTime(0.05, t + 0.075);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(og).connect(this.out);
    o.start(t + 0.07); o.stop(t + 0.13);
    const m = c.createOscillator(), mf = c.createBiquadFilter(), mg = c.createGain();
    m.type = 'sawtooth';
    m.frequency.setValueAtTime(92, t + 0.3);
    m.frequency.linearRampToValueAtTime(118, t + 1.35);
    mf.type = 'lowpass'; mf.frequency.value = 850;
    mg.gain.setValueAtTime(0.0001, t + 0.3);
    mg.gain.exponentialRampToValueAtTime(0.03, t + 0.38);
    mg.gain.setValueAtTime(0.03, t + 1.25);
    mg.gain.exponentialRampToValueAtTime(0.0001, t + 1.45);
    m.connect(mf).connect(mg).connect(this.out);
    m.start(t + 0.3); m.stop(t + 1.5);
  }

  // каждый кадр: рот по громкости записи или по «хлопкам» на гласных
  tick(dt) {
    let target;
    if (this.current && this.analyser) {
      this.analyser.getFloatTimeDomainData(this.buf);
      let s = 0;
      for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
      const rms = Math.sqrt(s / this.buf.length);
      target = Math.min(0.62, Math.max(0, (rms - 0.012) * 5.2));
    } else {
      target = this.flap;
    }
    this.flap *= Math.exp(-dt * 13);
    if (this.flap < 0.002) this.flap = 0;      // затухло — значит, ноль: по нему голова понимает, что договорила (спокойный режим, см. head.js)
    this.head.setMouth(target < 0.002 ? 0 : target);
  }
}
