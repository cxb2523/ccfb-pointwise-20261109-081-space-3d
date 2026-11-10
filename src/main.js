// jshint -W097
// jshint undef: true, unused: true
/* globals require,window,document,requestAnimationFrame,dat,location*/

"use strict";

var qs = require("query-string");
var glm = require("gl-matrix");
var saveAs = require("filesaver.js").saveAs;
var JSZip = require("jszip");
var Space3D = require("./space-3d.js");
var Skybox = require("./skybox.js");
var Starfield = require("./starfield.js");

var resolution = 1024;

// 星空球壳半径（世界单位）。相机始终在球壳内部推进，三层视差都在这颗球里。
var STAR_RADIUS = 4.0;

// ?twinkle 档位：只作为频率乘数传给 shader，不重建顶点、不重算相位。
var TWINKLE_PRESETS = [0.0, 0.5, 1.0, 2.0, 4.0];

window.onload = function() {
  var params = qs.parse(location.hash);

  var ControlsMenu = function() {
    this.seed = params.seed || generateRandomSeed();
    this.randomSeed = function() {
      this.seed = generateRandomSeed();
      renderTextures();
    };
    this.fov = parseInt(params.fov) || 80;
    this.pointStars =
      params.pointStars === undefined ? true : params.pointStars === "true";
    this.stars = params.stars === undefined ? true : params.stars === "true";
    this.sun = params.sun === undefined ? true : params.sun === "true";
    this.nebulae =
      params.nebulae === undefined ? true : params.nebulae === "true";
    this.resolution = parseInt(params.resolution) || 1024;
    this.animationSpeed =
      params.animationSpeed === undefined
        ? 1.0
        : parseFloat(params.animationSpeed);
    this.saveSkybox = function() {
      const zip = new JSZip();
      for (const name of ["front", "back", "left", "right", "top", "bottom"]) {
        const canvas = document.getElementById(`texture-${name}`);
        const data = canvas.toDataURL().split(",")[1];
        zip.file(`${name}.png`, data, { base64: true });
      }
      if (this.resolution <= 2048) {
        const cubemapData = this._saveCubemap().split(",")[1];
        zip.file('cubemap.png', cubemapData, { base64: true });
      }
      zip.generateAsync({ type: "blob" }).then(blob => {
        saveAs(blob, "skybox.zip");
      });
    };
    this._saveCubemap = function() {
      const cubemapCanvas = document.createElement('canvas');
      const left = document.getElementById('texture-left');
      const top = document.getElementById('texture-top');
      const front = document.getElementById('texture-front');
      const bottom = document.getElementById('texture-bottom');
      const right = document.getElementById('texture-right');
      const back = document.getElementById('texture-back');

      // set size of canvas depending on resolution
      var context = cubemapCanvas.getContext('2d');
      context.canvas.width = this.resolution * 4;
      context.canvas.height = this.resolution * 3;

      // combine images together in the texture-cubemap canvas
      context.drawImage(left, 0, this.resolution);
      context.drawImage(top, this.resolution, 0);
      context.drawImage(front, this.resolution, this.resolution);
      context.drawImage(bottom, this.resolution, this.resolution * 2);
      context.drawImage(right, this.resolution * 2, this.resolution);
      context.drawImage(back, this.resolution * 3, this.resolution);

      return cubemapCanvas.toDataURL("image/png");
    };
  };

  var menu = new ControlsMenu();
  var gui = new dat.GUI({
    autoPlace: false,
    width: 320
  });
  gui
    .add(menu, "seed")
    .name("Seed")
    .listen()
    .onFinishChange(renderTextures);
  gui.add(menu, "randomSeed").name("Randomize seed");
  gui.add(menu, "fov", 10, 150, 1).name("Field of view °");
  gui
    .add(menu, "pointStars")
    .name("Point stars")
    .onChange(renderTextures);
  gui
    .add(menu, "stars")
    .name("Bright stars")
    .onChange(renderTextures);
  gui
    .add(menu, "sun")
    .name("Sun")
    .onChange(renderTextures);
  gui
    .add(menu, "nebulae")
    .name("Nebulae")
    .onChange(renderTextures);
  gui
    .add(menu, "resolution", [256, 512, 1024, 2048, 4096])
    .name("Resolution")
    .onChange(renderTextures);
  gui.add(menu, "animationSpeed", 0, 10).name("Animation speed");
  gui.add(menu, "saveSkybox").name("Download skybox");

  document.body.appendChild(gui.domElement);
  gui.domElement.style.position = "fixed";
  gui.domElement.style.left = "16px";
  gui.domElement.style.top = "272px";

  function hideGui() {
    gui.domElement.style.display = "none";
  }

  function showGui() {
    gui.domElement.style.display = "block";
  }

  function hideSplit() {
    document.getElementById("texture-left").style.display = "none";
    document.getElementById("texture-right").style.display = "none";
    document.getElementById("texture-top").style.display = "none";
    document.getElementById("texture-bottom").style.display = "none";
    document.getElementById("texture-front").style.display = "none";
    document.getElementById("texture-back").style.display = "none";
  }

  function showSplit() {
    document.getElementById("texture-left").style.display = "block";
    document.getElementById("texture-right").style.display = "block";
    document.getElementById("texture-top").style.display = "block";
    document.getElementById("texture-bottom").style.display = "block";
    document.getElementById("texture-front").style.display = "block";
    document.getElementById("texture-back").style.display = "block";
  }

  function setQueryString() {
    location.hash = qs.stringify({
      seed: menu.seed,
      fov: menu.fov,
      pointStars: menu.pointStars,
      stars: menu.stars,
      sun: menu.sun,
      nebulae: menu.nebulae,
      resolution: menu.resolution,
      animationSpeed: menu.animationSpeed,
      twinkle: twinkleMultiplier
    });
  }

  var hideControls = false;

  // T 键在几档 ?twinkle 之间切换；只动频率乘数，相位缓冲保持不变。
  var twinkleMultiplier =
    params.twinkle === undefined ? 1.0 : parseFloat(params.twinkle);
  if (!isFinite(twinkleMultiplier) || twinkleMultiplier < 0) {
    twinkleMultiplier = 1.0;
  }
  var twinkleIndex = TWINKLE_PRESETS.indexOf(twinkleMultiplier);

  window.onkeypress = function(e) {
    if (e.charCode == 32) {
      hideControls = !hideControls;
    }
    if (e.charCode == 116 || e.charCode == 84) {
      twinkleIndex = (twinkleIndex + 1) % TWINKLE_PRESETS.length;
      twinkleMultiplier = TWINKLE_PRESETS[twinkleIndex];
      starfield.setTwinkle(twinkleMultiplier);
    }
  };

  var renderCanvas = document.getElementById("render-canvas");
  renderCanvas.width = renderCanvas.clientWidth;
  renderCanvas.height = renderCanvas.clientHeight;

  // 同一个 webgl 上下文：skybox 与星空共享，渲染顺序在每帧里显式控制。
  var gl = renderCanvas.getContext("webgl");

  var skybox = new Skybox(renderCanvas);
  var space = new Space3D(resolution);

  // 相机最远推进到约 3.4，把 skybox 立方壳放大到 8，保证整条路径都在壳内，
  // 且壳面远于星空球壳(R=4)，不会在 far plane 渐隐区之前露出白边。
  skybox.scale = 8.0;

  // 单 draw call 三层视差星空。seed 只决定一次顶点生成，之后不再重建。
  var starfield = new Starfield(gl, {
    radius: STAR_RADIUS,
    seed: hashcode(menu.seed + "|starfield"),
    twinkle: twinkleMultiplier
  });

  // 调试 HUD：帧率、推进距离、twinkle 档位、WebGL 错误计数。
  var hud = document.createElement("div");
  hud.style.cssText =
    "position:fixed;top:8px;left:8px;color:#9fe;font:12px monospace;" +
    "background:rgba(0,0,0,0.45);padding:8px 10px;pointer-events:none;" +
    "white-space:pre;line-height:1.5;";
  document.body.appendChild(hud);

  function renderTextures() {
    var textures = space.render({
      seed: menu.seed,
      pointStars: menu.pointStars,
      stars: menu.stars,
      sun: menu.sun,
      nebulae: menu.nebulae,
      resolution: menu.resolution
    });
    skybox.setTextures(textures);

    function drawIndividual(source, targetid) {
      var canvas = document.getElementById(targetid);
      canvas.width = canvas.height = menu.resolution;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(source, 0, 0);
    }

    drawIndividual(textures.left, "texture-left");
    drawIndividual(textures.right, "texture-right");
    drawIndividual(textures.front, "texture-front");
    drawIndividual(textures.back, "texture-back");
    drawIndividual(textures.top, "texture-top");
    drawIndividual(textures.bottom, "texture-bottom");
  }

  renderTextures();

  var tick = 0.0;
  var elapsed = 0.0;
  var lastTimestamp = null;

  // FPS 与 GL 错误采样。
  var fpsFrames = 0;
  var fpsWindowStart = null;
  var fps = 0;
  var glErrorCount = 0;
  var glErrorName = "";

  function render(timestamp) {
    hideGui();

    if (!hideControls) {
      showGui();
    }

    if (lastTimestamp === null) {
      lastTimestamp = timestamp;
      fpsWindowStart = timestamp;
    }
    var dt = Math.min(0.1, (timestamp - lastTimestamp) / 1000);
    lastTimestamp = timestamp;
    elapsed += dt;

    tick += 0.0025 * menu.animationSpeed;

    var view = glm.mat4.create();
    var projection = glm.mat4.create();

    renderCanvas.width = renderCanvas.clientWidth;
    renderCanvas.height = renderCanvas.clientHeight;

    // 长距离推进：相机在 0.3..1.4 之间沿视线缓慢往返。近层球壳内缘 0.1R、
    // 外缘 0.4R(=1.6)，把推进终点压在 1.4 可保证三层始终在视野内，
    // 同时相机能依次穿过近/中/远层的密度与尺寸梯度，看出纵深视差。
    // ?dolly= 仅用于无头环境下强制相机半径做验证，正常访问走时间曲线。
    var dolly = params.dolly === undefined
      ? 0.3 + 1.1 * (0.5 - 0.5 * Math.cos(elapsed * 0.12))
      : parseFloat(params.dolly);
    var az = elapsed * 0.05;
    var eye = [
      Math.cos(az) * dolly,
      Math.sin(elapsed * 0.04) * dolly * 0.35,
      Math.sin(az) * dolly
    ];
    glm.mat4.lookAt(view, eye, [0, 0, 0], [0, 1, 0]);

    var fov = (menu.fov / 360) * Math.PI * 2;
    // far plane 给到 16，几何不会被硬切；far plane 边缘的消失完全交给
    // shader 里按相机距离的 alpha 渐隐（0.85R..0.98R）。
    glm.mat4.perspective(
      projection,
      fov,
      renderCanvas.width / renderCanvas.height,
      0.05,
      16
    );

    // 每帧显式清屏并把主画布管线复位到不透明基线。原实现靠 skybox 立方壳
    // 不透明铺满而从不清屏；星空通道会临时开启 additive 混合，必须有显式
    // clear + 状态复位，否则 skybox 会在残留混合状态下逐帧叠加成白屏。
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // 渲染队列：skybox（含 sun/nebula/亮星烘焙结果）先画，星空最后画。
    // 星空在 starfield.render 内部切 additive + depthMask(false)，
    // 亮星只能提亮，永远不会靠写深度盖住 sun 或 skybox。
    skybox.render(view, projection);
    starfield.render(view, projection, elapsed);

    // 采样 WebGL 错误；正常情况下计数应始终为 0、控制台无 warning。
    var err = gl.getError();
    if (err !== gl.NO_ERROR) {
      glErrorCount += 1;
      glErrorName = "0x" + err.toString(16);
    }

    fpsFrames += 1;
    if (timestamp - fpsWindowStart >= 1000) {
      fps =
        (fpsFrames * 1000) / (timestamp - fpsWindowStart);
      fpsFrames = 0;
      fpsWindowStart = timestamp;

      hud.textContent =
        "fps: " + fps.toFixed(1) +
        "\ndolly: " + dolly.toFixed(2) + " / R=" + STAR_RADIUS +
        "\ntwinkle: x" + twinkleMultiplier + "  (T 切换, ?twinkle=0|0.5|1|2|4)" +
        "\nlayers: far 14000 small/dim | mid 4500 | near 1000 large/bright" +
        "\ncanvas css: " + renderCanvas.clientWidth + "x" + renderCanvas.clientHeight +
        " attr: " + renderCanvas.width + "x" + renderCanvas.height +
        "\ngl errors: " + glErrorCount +
        (glErrorName ? " (" + glErrorName + ")" : "");
    }

    requestAnimationFrame(render);

    setQueryString();
  }

  requestAnimationFrame(render);
};

function hashcode(str) {
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    var char = str.charCodeAt(i);
    hash += (i + 1) * char;
  }
  return hash;
}

function generateRandomSeed() {
  return (Math.random() * 1000000000000000000).toString(36);
}
