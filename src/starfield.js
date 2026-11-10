// jshint -W097
// jshint undef: true, unused: true
/* globals require,__dirname,Float32Array,module*/

"use strict";

var fs = require("fs");
var rng = require("rng");
var webgl = require("./webgl.js");

// 三层视差参数表。所有层共用同一套 buffer、同一次 draw call，
// 层间差异（密度/尺寸/alpha/频率区间）全部烘焙进顶点属性。
// 半径均为球壳半径 R 的比例值；size 同样是 R 的比例半边长，
// 实际世界半边长 = size * R，量级控制在亚视角，避免 additive 叠加洗白画面。
//   layer 0 暗远：最密、最小、最暗，贴在球壳外缘
//   layer 1 中等：密度/尺寸/亮度居中
//   layer 2 亮近：最疏、最大、最亮，靠近相机
var LAYERS = [
  {
    count: 14000,
    radiusMin: 0.66,
    radiusMax: 1.0,
    sizeMin: 0.0008,
    sizeMax: 0.0018,
    alphaMin: 0.1,
    alphaMax: 0.3,
    freqMin: 0.6,
    freqMax: 1.4
  },
  {
    count: 4500,
    radiusMin: 0.36,
    radiusMax: 0.7,
    sizeMin: 0.0016,
    sizeMax: 0.004,
    alphaMin: 0.3,
    alphaMax: 0.62,
    freqMin: 0.5,
    freqMax: 1.1
  },
  {
    count: 1000,
    radiusMin: 0.1,
    radiusMax: 0.4,
    sizeMin: 0.0035,
    sizeMax: 0.008,
    alphaMin: 0.65,
    alphaMax: 1.0,
    freqMin: 0.3,
    freqMax: 0.8
  }
];

var VERTICES_PER_STAR = 6;

// 距离渐隐区间（R 的比例）。
// 近端渐隐终点 0.14R 与亮近层内缘 0.10R、最大半边长 0.008R 衔接：
// 最靠近相机的大星点在扑屏前平滑变暗，而不是突然缩没或亮度断层。
var FADE_NEAR_START = 0.06;
var FADE_NEAR_END = 0.14;
var FADE_FAR_START = 0.85;
var FADE_FAR_END = 0.98;

module.exports = function Starfield(gl, options) {
  options = options || {};
  var self = this;

  var R = options.radius || 4.0;
  var seed = options.seed || 0;

  var vertSrc = fs.readFileSync(__dirname + "/glsl/star.vert.glsl", "utf8");
  var fragSrc = fs.readFileSync(__dirname + "/glsl/star.frag.glsl", "utf8");
  self.program = new webgl.Program(gl, vertSrc, fragSrc);

  // ---- 多缓冲回退口子 ---------------------------------------------------
  // 默认关闭：维持单 buffer、单 draw call。只有 Node 20 真机 profiler
  // 证明顶点层分支（aLayer 分支）开销稳定超过帧时间 5% 时，才把这里翻成
  // true 并按 LAYERS 拆成三套独立 buffer / 三次绘制；在拿到该证据前不动。
  self.multiBufferFallbackEnabled = false;

  // ?twinkle 只缩放这个乘数，缓冲不重建，CPU 预计算的随机相位保持不变。
  self.twinkle = options.twinkle === undefined ? 1.0 : options.twinkle;

  var totalStars = 0;
  for (var l = 0; l < LAYERS.length; l++) {
    totalStars += LAYERS[l].count;
  }
  var totalVerts = totalStars * VERTICES_PER_STAR;

  var positions = new Float32Array(totalVerts * 3);
  var colors = new Float32Array(totalVerts * 4);
  var corners = new Float32Array(totalVerts * 2);
  var layers = new Float32Array(totalVerts);
  var phases = new Float32Array(totalVerts);
  var frequencies = new Float32Array(totalVerts);
  var scales = new Float32Array(totalVerts);

  // 每颗星两个三角形组成的 billboard 四角（z=0，shader 里在视图空间展开）。
  var cornerTable = [
    -1, -1,
    1, -1,
    1, 1,
    -1, -1,
    1, 1,
    -1, 1
  ];

  var rand = new rng.MT(seed);
  var cursor = 0;

  for (var li = 0; li < LAYERS.length; li++) {
    var cfg = LAYERS[li];
    var rMin3 = Math.pow(cfg.radiusMin * R, 3);
    var rMax3 = Math.pow(cfg.radiusMax * R, 3);

    for (var s = 0; s < cfg.count; s++) {
      // 球壳内均匀取方向。
      var z = rand.random() * 2.0 - 1.0;
      var theta = rand.random() * Math.PI * 2.0;
      var ring = Math.sqrt(Math.max(0.0, 1.0 - z * z));
      var dx = ring * Math.cos(theta);
      var dy = z;
      var dz = ring * Math.sin(theta);

      // 体积均匀的半径采样，保证"远密近疏"是层间参数而非采样偏差。
      var dist = Math.pow(rMin3 + rand.random() * (rMax3 - rMin3), 1 / 3);

      var size =
        (cfg.sizeMin + rand.random() * (cfg.sizeMax - cfg.sizeMin)) * R;
      var alpha =
        cfg.alphaMin + rand.random() * (cfg.alphaMax - cfg.alphaMin);

      // 闪烁相位与基础频率在 CPU 侧预计算，逐星随机、错相。
      var phase = rand.random() * Math.PI * 2.0;
      var frequency =
        cfg.freqMin + rand.random() * (cfg.freqMax - cfg.freqMin);

      // 轻微冷暖偏移，保持白色基调，additive 混合下层次仍由 alpha 决定。
      var tintR = 0.85 + rand.random() * 0.15;
      var tintG = 0.85 + rand.random() * 0.15;
      var tintB = 0.85 + rand.random() * 0.15;

      for (var v = 0; v < VERTICES_PER_STAR; v++) {
        var idx = cursor + v;
        positions[idx * 3] = dx * dist;
        positions[idx * 3 + 1] = dy * dist;
        positions[idx * 3 + 2] = dz * dist;

        colors[idx * 4] = alpha * tintR;
        colors[idx * 4 + 1] = alpha * tintG;
        colors[idx * 4 + 2] = alpha * tintB;
        colors[idx * 4 + 3] = alpha;

        corners[idx * 2] = cornerTable[v * 2];
        corners[idx * 2 + 1] = cornerTable[v * 2 + 1];

        layers[idx] = li;
        phases[idx] = phase;
        frequencies[idx] = frequency;
        scales[idx] = size;
      }
      cursor += VERTICES_PER_STAR;
    }
  }

  // 单套 buffer：七层属性交织在同一批顶点里，一次 drawArrays 提交。
  var attribs = webgl.buildAttribs(gl, {
    aPosition: 3,
    aColor: 4,
    aCorner: 2,
    aLayer: 1,
    aPhase: 1,
    aFrequency: 1,
    aScale: 1
  });
  attribs.aPosition.buffer.set(positions);
  attribs.aColor.buffer.set(colors);
  attribs.aCorner.buffer.set(corners);
  attribs.aLayer.buffer.set(layers);
  attribs.aPhase.buffer.set(phases);
  attribs.aFrequency.buffer.set(frequencies);
  attribs.aScale.buffer.set(scales);

  self.renderable = new webgl.Renderable(
    gl,
    self.program,
    attribs,
    totalVerts / 3
  );

  // 运行时只改频率乘数，绝不重算相位/重建缓冲。
  self.setTwinkle = function(value) {
    self.twinkle = value;
  };

  self.render = function(view, projection, time) {
    var p = self.program;
    p.use();
    p.setUniform("uView", "Matrix4fv", false, view);
    p.setUniform("uProjection", "Matrix4fv", false, projection);
    p.setUniform("uTime", "1f", time);
    p.setUniform("uTwinkle", "1f", self.twinkle);
    p.setUniform("uFadeNearStart", "1f", FADE_NEAR_START * R);
    p.setUniform("uFadeNearEnd", "1f", FADE_NEAR_END * R);
    p.setUniform("uFadeFarStart", "1f", FADE_FAR_START * R);
    p.setUniform("uFadeFarEnd", "1f", FADE_FAR_END * R);

    // 渲染队列约定：skybox 先画，星空最后画。
    // additive 混合 + 不写深度：亮星只能提亮画面，不能靠深度盖住 sun/skybox。
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);

    self.renderable.render();

    // 完整恢复进入前的管线状态，尤其要 disable BLEND：
    // 主画布默认不混合，skybox 靠不透明覆盖逐帧铺满，残留的混合开关会让
    // 未清屏的 skybox 逐帧叠加成白屏。
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.blendFuncSeparate(
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ZERO,
      gl.ONE
    );
  };
};
