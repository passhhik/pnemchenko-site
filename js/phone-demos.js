// Интерактивные области живут в тех же координатах 393 × 852, что и слои экрана.
import { esc } from './content.js';

export function demoHTML(scene) {
  if (scene.picker) {
    const categories = scene.picker.map((group, i) =>
      `<button type="button" data-category="${i}" aria-pressed="${i === 0}"><img src="${esc(group.icon)}" alt=""><span>${esc(group.title)}</span></button>`);
    return `<div class="card-picker" data-picker>
      <div class="pick-track" tabindex="0" role="region" aria-label="Дизайны карт"></div>
      <div class="pick-pages" role="group" aria-label="Страницы коллекции"></div>
      <div class="pick-categories" role="group" aria-label="Категории карт">${categories.join('')}</div></div>`;
  }
  if (!scene.tasks) return '';
  const tasks = scene.tasks.map((task, i) =>
    `<article class="${(task.blue ?? i === 0) ? 'task-blue' : ''}"><small>${esc(task.when)}</small><span>${esc(task.title)}</span><strong>${esc(task.reward)}</strong></article>`).join('');
  const cards = scene.strip?.layer === 'tasks' ? `<div class="task-strip">${tasks}</div>` : tasks;
  return `<div class="task-track" tabindex="0" role="region" aria-label="Задания и поступления">${cards}</div>`;
}

export function initDemo(phone, scene, reduced) {
  const track = phone.querySelector('.pick-track, .task-track');
  if (!track) return () => {};
  const picker = phone.querySelector('[data-picker]');
  const strip = track.querySelector('.task-strip');
  const pages = phone.querySelector('.pick-pages');
  const events = new AbortController();
  const opts = { signal: events.signal };
  const behavior = reduced ? 'instant' : 'smooth';
  let index = 0, direction = 1, timer = 0, lastUse = 0;
  let holding = false, dragged = false, startX = 0, startLeft = 0;
  const markUse = () => {
    lastUse = Date.now();
    if (!strip || reduced || track.classList.contains('is-browsing')) return;
    // Передаём ленту пальцу в том же положении, где её застал пользователь.
    const transform = getComputedStyle(strip).transform;
    const left = transform === 'none' ? 0 : -new DOMMatrixReadOnly(transform).m41;
    track.classList.add('is-browsing');
    track.scrollLeft = left;
  };

  function target(i) {
    return Math.min(track.scrollWidth - track.clientWidth, track.children[i].offsetLeft - track.firstElementChild.offsetLeft);
  }
  function showCard(i, motion = behavior) {
    track.scrollTo({ left: target(i), behavior: motion });
  }
  function sync() {
    if (!picker) return;
    const closest = [...track.children].reduce((best, _, i) =>
      Math.abs(target(i) - track.scrollLeft) < Math.abs(target(best) - track.scrollLeft) ? i : best, 0);
    index = closest;
    [...pages.children].forEach((dot, i) => dot.setAttribute('aria-current', String(i === index)));
  }
  function showCollection(group) {
    index = 0;
    direction = 1;
    const cards = scene.picker[group].cards;
    track.innerHTML = cards.map((card, i) =>
      `<img src="${esc(card.src)}" alt="${esc(card.alt)}" draggable="false" data-design="${i}">`).join('');
    pages.innerHTML = cards.map((_, i) =>
      `<button type="button" data-page="${i}" aria-label="Дизайн ${i + 1} из ${cards.length}"></button>`).join('');
    picker.querySelectorAll('[data-category]').forEach((button, i) => button.setAttribute('aria-pressed', String(i === group)));
    showCard(0, 'instant');
    sync();
  }
  if (picker) {
    showCollection(0);
    picker.addEventListener('click', e => {
      const button = e.target.closest('button,[data-design]');
      if (!button) return;
      markUse();
      if (button.hasAttribute('data-category')) showCollection(+button.dataset.category);
      else if (button.hasAttribute('data-page')) showCard(+button.dataset.page);
      else if (button.hasAttribute('data-design')) showCard(+button.dataset.design);
    }, opts);
  }
  track.addEventListener('scroll', sync, opts);
  track.addEventListener('wheel', e => {
    if (!strip || Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) markUse();
  }, { ...opts, passive: true });
  track.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    markUse();
    if (!picker) {
      const toStart = e.key === 'Home' || e.key === 'ArrowLeft';
      track.scrollTo({ left: toStart ? 0 : track.scrollWidth, behavior });
      return;
    }
    const last = track.children.length - 1;
    const destinations = { Home: 0, End: last, ArrowLeft: Math.max(0, index - 1), ArrowRight: Math.min(last, index + 1) };
    showCard(destinations[e.key]);
  }, opts);

  // Свайп и трекпад обрабатывает браузер. Мышь двигает ленту в координатах уменьшенного телефона.
  track.addEventListener('pointerdown', e => {
    markUse();
    dragged = false;
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    holding = true;
    startX = e.clientX;
    startLeft = track.scrollLeft;
  }, opts);
  track.addEventListener('pointermove', e => {
    if (!holding) return;
    const dx = e.clientX - startX;
    if (!dragged && Math.abs(dx) < 4) return;
    dragged = true;
    track.setPointerCapture(e.pointerId);
    track.classList.add('dragging');
    const scale = track.getBoundingClientRect().width / track.offsetWidth;
    track.scrollLeft = startLeft - dx / scale;
  }, opts);
  const endDrag = () => { holding = false; track.classList.remove('dragging'); };
  window.addEventListener('pointerup', endDrag, opts);
  window.addEventListener('pointercancel', endDrag, opts);
  track.addEventListener('click', e => {
    if (dragged) { e.stopImmediatePropagation(); dragged = false; }
  }, { ...opts, capture: true });

  function tick() {
    if (document.hidden || holding || Date.now() - lastUse < 8000 || phone.querySelector(':focus-visible')) return;
    if (!picker) {
      track.scrollTo({ left: track.scrollLeft > 1 ? 0 : track.scrollWidth, behavior });
      return;
    }
    if (index === track.children.length - 1) direction = -1;
    if (index === 0) direction = 1;
    showCard(index + direction);
  }
  function setVisible(visible) {
    clearInterval(timer);
    if (strip) {
      if (!visible && track.classList.contains('is-browsing')) {
        track.scrollLeft = 0;
        track.classList.remove('is-browsing');
      }
    } else if (visible && !reduced) timer = setInterval(tick, picker ? 2350 : 3300);
  }
  const observer = 'IntersectionObserver' in window
    ? new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    : null;
  if (observer) observer.observe(phone);
  else setVisible(true);
  return () => {
    clearInterval(timer);
    observer?.disconnect();
    events.abort();
  };
}
