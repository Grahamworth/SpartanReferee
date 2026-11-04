// Shared bits for the pages admins can edit: a pop-up editor, form fields, and a toast.
import { esc } from './api-base.js';

export function toast(s) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast-msg'; document.body.appendChild(t); }
  t.textContent = s; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2400);
}
export const field = (label, name, value, type = 'text') => type === 'area'
  ? `<label>${label}<textarea name="${name}">${esc(value)}</textarea></label>`
  : `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}"></label>`;
export const val = (el, name) => (el.querySelector(`[name="${name}"]`) || {}).value || '';

/** a pop-up with fields; onSave(body) saves (throw to show an error); onAdd(body) adds an item */
export function editor(title, bodyHtml, onSave, onAdd) {
  const bg = document.createElement('div'); bg.className = 'ed-bg';
  bg.innerHTML = `<div class="ed" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><div class="body">${bodyHtml}</div><p class="err" hidden></p>
    <div class="row">${onAdd ? '<button type="button" class="btn btn-ghost add">Add</button>' : ''}<button type="button" class="btn btn-ghost cancel">Cancel</button><button type="button" class="btn btn-red save">Save</button></div></div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.querySelector('.cancel').onclick = close;
  bg.onclick = (e) => { if (e.target === bg) close(); };
  if (onAdd) bg.querySelector('.add').onclick = () => onAdd(bg.querySelector('.body'));
  bg.addEventListener('click', (e) => { if (e.target.classList.contains('rm')) e.target.closest('.item').remove(); });
  bg.querySelector('.save').onclick = async () => {
    const err = bg.querySelector('.err');
    try { await onSave(bg.querySelector('.body')); close(); toast('Saved'); } catch (e) { err.hidden = false; err.textContent = e.message; }
  };
}
