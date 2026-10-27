const grid = document.getElementById('grid');
const share = document.getElementById('share');
const audio = document.getElementById('audio');
const tabs = [...document.querySelectorAll('[role=tab]')];

let sources = [];
let kind = 'screen';
let selected = null;

function render() {
  grid.replaceChildren();
  const visible = sources.filter((s) => s.kind === kind);
  if (!visible.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = kind === 'screen' ? 'No screens found.' : 'No windows to share.';
    grid.append(li);
  }
  for (const s of visible) {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.tabIndex = 0;
    li.setAttribute('aria-selected', String(s.id === selected));
    const thumb = document.createElement('img');
    thumb.className = 'thumb';
    thumb.src = s.thumbnail;
    thumb.alt = '';
    const name = document.createElement('div');
    name.className = 'name';
    if (s.appIcon) {
      const icon = document.createElement('img');
      icon.src = s.appIcon;
      icon.alt = '';
      name.append(icon);
    }
    const label = document.createElement('span');
    label.textContent = s.name;
    name.append(label);
    li.append(thumb, name);
    li.addEventListener('click', () => select(s.id));
    li.addEventListener('dblclick', () => {
      select(s.id);
      done();
    });
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        select(s.id);
        done();
      }
    });
    grid.append(li);
  }
}

function select(id) {
  selected = id;
  share.disabled = !id;
  render();
}

function done() {
  if (selected) window.picker.choose(selected, audio.checked);
}

for (const tab of tabs) {
  tab.addEventListener('click', () => {
    kind = tab.dataset.kind;
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    render();
  });
}
share.addEventListener('click', done);
document.getElementById('cancel').addEventListener('click', () => window.picker.choose(null, false));
document.addEventListener('keydown', (e) => e.key === 'Escape' && window.picker.choose(null, false));

window.picker.getSources().then((list) => {
  sources = list;
  const screens = list.filter((s) => s.kind === 'screen');
  if (screens.length === 1) select(screens[0].id);
  else render();
});
