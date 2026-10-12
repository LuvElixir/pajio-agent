const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Minimal DOM fixture: identity represents media playback, selection and open UI.
function fixture() {
  const root = {children: [], insertBefore(node, before) {
    node.remove();
    const index = before ? this.children.indexOf(before) : this.children.length;
    assert.ok(index >= 0); this.children.splice(index, 0, node); node.parent = this;
  }};
  const makeNode = (id, html) => ({id, html, parent: null, remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }, replaceWith(next) {
    const parent = this.parent, index = parent.children.indexOf(this);
    this.parent = null; parent.children[index] = next; next.parent = parent;
  }});
  let created = 0;
  const context = {$: () => root, turnMarkup: message => JSON.stringify(message), document: {
    createElement: () => ({content: {}, set innerHTML(html) {
      created++; const message = JSON.parse(html);
      this.content.firstElementChild = makeNode(`${message.kind === 'goal_step' ? 'goal-turn' : 'task-turn'}-${message.turn.id}`, html);
    }}),
  }};
  const source = fs.readFileSync('src/pajio/web/app.js', 'utf8');
  vm.runInNewContext(source.slice(source.indexOf('const turnHTML ='), source.indexOf('async function loadConversation')), context);
  return {root, render: context.reconcileConversation, created: () => created};
}
const message = (id, output = '', kind = 'task') => ({kind, turn: {id, output}});

test('streaming one reply preserves the other turns and their interactive state', () => {
  const f = fixture(); f.render([message('a', 'saved'), message('b', 'first')]);
  const saved = f.root.children[0], streaming = f.root.children[1]; saved.open = true;
  f.render([message('a', 'saved'), message('b', 'first second')]);
  assert.equal(f.root.children[0], saved); assert.equal(saved.open, true);
  assert.notEqual(f.root.children[1], streaming); assert.equal(f.created(), 3);
  f.render([message('a', 'saved'), message('b', 'first second')]);
  assert.equal(f.created(), 3);
});
test('ordering, task/goal identifiers and clearing an identity are correct', () => {
  const f = fixture(); const a = message('a'), b = message('a', '', 'goal_step');
  f.render([a, b]); const first = f.root.children[0], second = f.root.children[1];
  f.render([b, a]); assert.equal(f.root.children[0], second); assert.equal(f.root.children[1], first);
  f.render([a, message('c')]); assert.equal(f.root.children[0], first); assert.equal(second.parent, null);
  f.render([]); assert.equal(f.root.children.length, 0); assert.equal(first.parent, null);
});
