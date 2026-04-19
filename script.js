/* ── Header scroll ── */
const header = document.getElementById('header');
window.addEventListener('scroll', () => {
  header.classList.toggle('scrolled', window.scrollY > 40);
});

/* ── Mobile menu ── */
const burger = document.getElementById('burger');
const mobileNav = document.getElementById('mobileNav');
burger.addEventListener('click', () => {
  mobileNav.classList.toggle('open');
});
document.querySelectorAll('.mobile-nav__link').forEach(link => {
  link.addEventListener('click', () => mobileNav.classList.remove('open'));
});

/* ── Reveal on scroll ── */
const reveals = document.querySelectorAll(
  '.card, .skills__table-wrap, .exp-item, .video-section__text, .video-section__player, .contact__left, .contact__form, .faq__accordion'
);
reveals.forEach(el => el.classList.add('reveal'));

const observer = new IntersectionObserver(entries => {
  entries.forEach((e, i) => {
    if (e.isIntersecting) {
      setTimeout(() => e.target.classList.add('visible'), i * 80);
      observer.unobserve(e.target);
    }
  });
}, { threshold: 0.12 });
reveals.forEach(el => observer.observe(el));

/* ── Skill bar animation ── */
const barObserver = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.querySelectorAll('.skills__bar-fill').forEach(bar => {
        bar.classList.add('animated');
      });
      barObserver.unobserve(e.target);
    }
  });
}, { threshold: 0.3 });
const tableWrap = document.querySelector('.skills__table-wrap');
if (tableWrap) barObserver.observe(tableWrap);

/* ── Contact form ── */
const form = document.getElementById('contactForm');
const successMsg = document.getElementById('formSuccess');
if (form) {
  form.addEventListener('submit', e => {
    e.preventDefault();
    const consent = form.querySelector('#consent');
    if (!consent.checked) {
      consent.closest('.checkbox-label').style.color = '#ef4444';
      return;
    }
    const btn = form.querySelector('.btn-submit');
    btn.textContent = 'Sending…';
    btn.disabled = true;
    setTimeout(() => {
      form.reset();
      btn.textContent = 'Send message';
      btn.disabled = false;
      successMsg.style.display = 'block';
      setTimeout(() => successMsg.style.display = 'none', 5000);
    }, 1200);
  });
}
