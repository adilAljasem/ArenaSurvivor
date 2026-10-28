// Run with Node 22.13+ (built-in TypeScript stripping):
// node --test Client/tests/combat-feedback.test.cjs
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

// Exercise the actual renderer without a browser/WebGL context or new dependencies.
// Imports are replaced by the scene/component stubs supplied to each isolated run.
const source = stripTypeScriptTypes(
  readFileSync(resolve(__dirname, '../src/RenderSystems.ts'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^export /gm, ''),
);

function renderFeedback(state, { jitter = 10, configs = {}, poolLimit = Infinity } = {}) {
  const labels = [];
  const particles = [];
  const tweens = [];
  const data = new Map();
  const randomMath = Object.create(Math);
  randomMath.random = () => 0; // deterministic particle spawning and camera bump

  function displayObject(x, y) {
    return {
      x, y,
      setOrigin() { return this; },
      setDepth() { return this; },
      setScale() { return this; },
      setTint(color) { this.tint = color; return this; },
      setTintFill(color) { this.tint = color; return this; },
      setActive() { return this; },
      setVisible() { return this; },
      setPosition(x, y) { this.x = x; this.y = y; return this; },
      setDisplaySize() { return this; },
      setAlpha() { return this; },
      destroy() {},
    };
  }

  const scene = {
    data: { get: key => data.get(key), set: (key, value) => data.set(key, value) },
    add: {
      group: () => ({
        get(x, y) {
          if (particles.length >= poolLimit) return null;
          const particle = displayObject(x, y);
          particles.push(particle);
          return particle;
        },
      }),
      bitmapText(x, y, font, text) {
        const label = { ...displayObject(x, y), text };
        labels.push(label);
        return label;
      },
    },
    cameras: { main: { zoom: 1 } },
    tweens: {
      isTweening: () => false,
      add: tween => { tweens.push(tween); return tween; },
    },
  };
  const context = vm.createContext({
    Phaser: { Math: { Between: () => jitter }, GameObjects: { Sprite: class {} } },
    world: { pickups: new Map() },
    Math: randomMath,
  });
  vm.runInContext(`${source}\nthis.WorldRenderer = WorldRenderer;`, context);
  context.WorldRenderer.render(scene, state, new Map(), new Map(), configs, new Map());
  return { labels, particles, tweens };
}

for (const [x, y] of [[0, 0], [0, 100], [100, 0], [100, 200]]) {
  test(`damage feedback retains finite coordinates at (${x}, ${y})`, () => {
    const { labels, particles } = renderFeedback({ damageEvents: [{ x, y, amount: 12 }] });
    assert.equal(labels[0].x, x + 10);
    assert.equal(labels[0].y, y - 6);
    assert.equal(labels[0].text, '12');
    assert.equal(particles.length, 4);
    for (const particle of particles) {
      assert.equal(particle.x, x);
      assert.equal(particle.y, y);
    }
  });
}

test('PascalCase positions remain supported, including zero', () => {
  const { labels } = renderFeedback({ DamageEvents: [{ X: 0, Y: 0, Amount: 9 }] });
  assert.equal(labels[0].x, 10);
  assert.equal(labels[0].y, -6);
});

for (const actorGroup of ['players', 'enemies']) {
  for (const jitter of [-10, 10]) {
    test(`${actorGroup} friendly-hit suppression uses impact, not label jitter ${jitter}`, () => {
      const { particles } = renderFeedback({
        damageEvents: [{ x: 100, y: 100, amount: 12 }],
        [actorGroup]: [{ x: 100, y: 139, team: 'Player' }],
      }, { jitter });
      assert.equal(particles.length, 0);
    });
  }
}

test('enemy blood color is selected nearest the impact, not nearest the label', () => {
  const { particles, tweens } = renderFeedback({
    damageEvents: [{ x: 100, y: 100, amount: 12 }],
    enemies: [
      { x: 100, y: 100, team: 'Enemy', configId: 'green' },
      { x: 110, y: 94, team: 'Enemy', configId: 'red' },
    ],
  }, { configs: { enemies: { green: { calculatedBloodColor: 0x00ff00 }, red: { calculatedBloodColor: 0xff0000 } } } });
  assert.equal(particles[0].tint, 0x00ff00);
  const particleTween = tweens.find(tween => tween.targets === particles[0]);
  assert.equal(particleTween.x, 160);
  assert.equal(particleTween.y, 100);
});

for (const [event, text, tint] of [
  [{ amount: -5 }, '+5', 0x00ff00],
  [{ amount: 0, isDodge: true }, 'DODGE', 0x00e5ff],
  [{ amount: 0, isBlock: true }, 'BLOCK', 0xb0bec5],
]) {
  test(`${text} keeps its existing label and produces no blood particles`, () => {
    const { labels, particles } = renderFeedback({ damageEvents: [{ x: 0, y: 0, ...event }] });
    assert.equal(labels[0].text, text);
    assert.equal(labels[0].tint, tint);
    assert.equal(particles.length, 0);
  });
}

test('critical hit label and burst size are preserved', () => {
  const { labels, particles } = renderFeedback({ damageEvents: [{ x: 100, y: 100, amount: 20, isCritical: true }] });
  assert.equal(labels[0].text, 'CRIT 20');
  assert.equal(labels[0].tint, 0xffeb3b);
  assert.equal(particles.length, 8);
});

test('feedback caps and exhausted particle pool remain safe', () => {
  const damageEvents = Array.from({ length: 50 }, () => ({ x: 100, y: 100, amount: 1 }));
  const capped = renderFeedback({ damageEvents });
  assert.equal(capped.labels.length, 40);
  assert.equal(capped.particles.length, 40 * 4);
  const exhausted = renderFeedback({ damageEvents }, { poolLimit: 0 });
  assert.equal(exhausted.labels.length, 40);
  assert.equal(exhausted.particles.length, 0);
});
