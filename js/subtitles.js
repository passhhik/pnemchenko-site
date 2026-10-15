// Субтитры под головой: реплика печатается по буквам, рот двигается в такт, потом текст гаснет.
// Про плавность. Буквы проявляются без «ускоренных» эффектов (прозрачность с переходом у каждой буквы заставляла
// браузер заводить под неё отдельный слой — по два десятка в секунду; в Safari от этого мигало матовое стекло папок).
// Гаснет реплика целиком: меняется прозрачность всего блока субтитров, у которого слой один и постоянный.
import { VOWELS } from './voice.js';
import { typo } from './typo.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CPS = 24;                             // скорость печати без записи голоса, букв в секунду
// Абзац реплики. Слово — <span class="w"> (не рвётся при переносе), внутри — буквы <span class="c">: они проявляются
// по одной, место под всю реплику занято сразу, поэтому текст не прыгает. Предложение — <span class="s">:
// на главной строка переносится между предложениями, а не посреди фразы. \n в тексте — перенос строки.
// Типографика — общая для сайта (js/typo.js): тире не уезжает в начало строки, короткое слово не остаётся в конце —
// они склеены с соседом неразрывным пробелом, и такая связка — одно «слово».
export function buildLine(text) {
  const tokens = typo(String(text)).split(/(\n|[^\S\n\u00A0]+)/).filter((w) => w.length);
  const isSpace = (w) => /^[^\S\n\u00A0]+$/.test(w);
  const p = document.createElement('p');
  p.className = 'subs-line';
  const spans = [];
  let sent = null;
  for (const w of tokens) {
    if (w === '\n') { p.appendChild(document.createElement('br')); sent = null; continue; }
    const s = document.createElement('span');
    const space = isSpace(w);
    s.className = space ? 'ws' : 'w';
    if (space) s.textContent = w;
    else {
      for (const ch of w) {
        // знак ударения и прочие «надстрочные» остаются при своей букве
        if (/\p{M}/u.test(ch) && s.lastChild) { s.lastChild.textContent += ch; continue; }
        const c = document.createElement('span');
        c.className = 'c';
        c.textContent = ch;
        s.appendChild(c);
      }
    }
    if (space) (sent || p).appendChild(s);
    else {
      if (!sent) { sent = document.createElement('span'); sent.className = 's'; p.appendChild(sent); }
      sent.appendChild(s);
      if (/[.!?…][»"”)]*$/.test(w)) sent = null;
    }
    spans.push(s);
  }
  return { p, spans };
}

export class Subtitles {
  constructor({ el, srEl, voice, lines, fmt, reducedMotion }) {
    this.el = el; this.srEl = srEl; this.voice = voice; this.lines = lines; this.fmt = fmt; this.rm = reducedMotion;
    this.token = 0; this.last = 0; this.busyUntil = 0; this.readUntil = 0;
    this.onLine = null;       // (id) — началась реплика: страница может на неё отозваться (например, голова смотрит на кнопку, о которой говорит)
  }

  text(id) { return this.fmt(this.lines[id] ?? id); }

  // ids — id реплики или список; pick — взять случайную из списка, иначе сказать все по очереди.
  // force — перебить текущую реплику; иначе реакции не чаще раза в 1,8 с и не поверх длинной фразы.
  async say(ids, { force = false, pick = false } = {}) {
    const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    if (!list.length) return;
    const now = performance.now();
    if (!force && (now - this.last < 1800 || now < this.busyUntil)) return;
    const seq = pick ? [list[Math.floor(Math.random() * list.length)]] : list;
    const token = ++this.token;
    const alive = () => token === this.token;
    this.last = now;
    this.voice.stop();
    for (let i = 0; i < seq.length; i++) {
      if (!alive()) return;
      const more = i < seq.length - 1;
      await this._line(seq[i], alive, more);
    }
  }

  clear() { ++this.token; this.voice.stop(); this.el.innerHTML = ''; this.el.classList.remove('is-out'); this.busyUntil = 0; this._speaking(false); }

  // пока голова говорит, у кнопки «Звук» пляшут столбики
  _speaking(on) { document.body.classList.toggle('is-speaking', on); }

  // В углу (каталог, кейс) блок реплики ужимается по самой длинной строке: у текста и у «облачка»
  // не остаётся пустого места справа, реплика стоит вплотную к голове
  _hug(p) {
    if (document.body.dataset.view === 'hero') return;
    const words = p.querySelectorAll('.w');
    if (!words.length) return;
    const cs = getComputedStyle(p);
    const padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0;
    const left = p.getBoundingClientRect().left + padL;
    let right = 0;
    for (const w of words) right = Math.max(right, w.getBoundingClientRect().right);
    if (!(right > left)) return;
    p.style.width = `${Math.ceil(right - left) + 1 + (cs.boxSizing === 'border-box' ? padL + padR : 0)}px`;
  }

  // На главной реплика — не больше трёх строк (Figma: «Реплика»): длиннее — кегль чуть уменьшается, но не меньше 80%
  _fit(p) {
    this.el.style.fontSize = '';
    if (document.body.dataset.view !== 'hero') return;
    const base = parseFloat(getComputedStyle(this.el).fontSize) || 0;
    if (!base) return;
    for (let k = 1; k > 0.8; k -= 0.05) {
      if (k < 1) this.el.style.fontSize = `${(base * k).toFixed(2)}px`;
      const lh = parseFloat(getComputedStyle(p).lineHeight) || base * k * 1.15;
      if (p.offsetHeight <= lh * 3 + 2) return;
    }
  }

  async _line(id, alive, more) {
    const text = this.text(id);
    this.srEl.textContent = text.replace(/\n/g, ' ');
    const { p, spans } = buildLine(text);
    this.el.innerHTML = '';
    this.el.appendChild(p);
    this.el.classList.remove('is-out');
    this._fit(p);
    this._hug(p);
    let audio = null;
    if (this.voice.has(id)) audio = await this.voice.play(id);
    if (!alive()) return;
    // Расписание: когда появляется каждая буква (мс от начала реплики). На знаках препинания — пауза, как в живой речи.
    // Печатаем по часам, а не «буква — таймер — буква»: так скорость не плывёт, когда браузер занят отрисовкой головы.
    const step = 1000 / CPS, plan = [];
    let total = 0;
    for (const s of spans) {
      if (s.className.startsWith('ws')) { total += step; continue; }
      for (const c of s.children) {
        const ch = c.textContent;
        plan.push({ c, at: total, vowel: VOWELS.test(ch) });
        total += step * (/[.!?…]/.test(ch) ? 5 : /[,:;—]/.test(ch) ? 2.5 : 1);
      }
    }
    // с записью голоса текст идёт в её темпе и заканчивается вместе с ней
    const k = audio && total > 0 ? Math.min(2.4, Math.max(0.3, (Math.max(0.4, audio.duration - 0.15) * 1000) / total)) : 1;
    total *= k;
    const t0 = performance.now();
    this.busyUntil = t0 + total + 600;
    this._speaking(true);
    if (this.onLine) this.onLine(id);
    if (this.rm) spans.forEach((s) => s.classList.add('is-on'));
    else {
      for (let i = 0; i < plan.length;) {
        const now = performance.now() - t0;
        let vowel = false;
        while (i < plan.length && plan[i].at * k <= now) { plan[i].c.classList.add('is-on'); vowel = vowel || plan[i].vowel; i++; }
        if (vowel && !audio) this.voice.vowel();
        await sleep(i < plan.length ? Math.max(4, plan[i].at * k - (performance.now() - t0)) : Math.max(0, total - (performance.now() - t0)));
        if (!alive()) return;
      }
    }
    if (audio) await audio.done;
    if (!alive()) return;
    this._speaking(false);
    this.readUntil = performance.now() + 1400;        // реплику только что договорили — дайте её дочитать
    await sleep(more ? 700 : Math.max(1600, text.length * 55));
    if (!alive()) return;
    this.el.classList.add('is-out');
    await sleep(more ? 250 : 500);
  }
}
