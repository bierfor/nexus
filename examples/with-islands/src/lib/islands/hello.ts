export default function init(root: HTMLElement) {
  const p = root.querySelector('p');
  if (!p) return;
  p.textContent = 'Hello from external island! 🎉';
  p.style.color = '#c45c26';
}
