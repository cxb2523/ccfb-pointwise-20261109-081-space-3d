// jshint -W097
// jshint undef: true, unused: true
/* globals require,__dirname,Float32Array,module*/

"use strict";

var fs = require("fs");
var glm = require("gl-matrix");
var webgl = require("./webgl.js");
var util = require("./util.js");

module.exports = function(renderCanvas) {

    var self = this;

    self.initialize = function() {
        self.gl = renderCanvas.getContext("webgl");
        self.gl.pixelStorei(self.gl.UNPACK_FLIP_Y_WEBGL, true);
        self.pSkybox = util.loadProgram(self.gl, fs.readFileSync(__dirname + "/glsl/skybox.glsl", "utf8"));
        self.rSkybox = buildQuad(self.gl, self.pSkybox);
        self.textures = {};
        // 镜头推进时相机可能远离原点，把贴图立方壳整体放大到始终包住相机路径。
        // 只缩放顶点、不改 UV，贴图外观不变；默认 1 保持原有行为。
        self.scale = 1.0;
    };

    self.setTextures = function(canvases) {
        self.textures = {};
        var keys = Object.keys(canvases);
        for (var i = 0; i < keys.length; i++) {
            var c = canvases[keys[i]];
            self.textures[keys[i]] = new webgl.Texture(self.gl, 0, c, c.width, c.height, {
                min: self.gl.LINEAR_MIPMAP_LINEAR,
                mag: self.gl.LINEAR,
            });
        }
    };

    self.render = function(view, projection) {
        self.gl.viewport(0, 0, renderCanvas.width, renderCanvas.height);

        var model = glm.mat4.create();
        var scaled = glm.mat4.create();

        function drawScaled(baseModel) {
            glm.mat4.copy(scaled, baseModel);
            glm.mat4.scale(scaled, scaled, [self.scale, self.scale, self.scale]);
            self.pSkybox.setUniform("uModel", "Matrix4fv", false, scaled);
            self.rSkybox.render();
        }

        self.pSkybox.use();
        self.pSkybox.setUniform("uView", "Matrix4fv", false, view);
        self.pSkybox.setUniform("uProjection", "Matrix4fv", false, projection);

        self.textures.front.bind();
        model = glm.mat4.create();
        drawScaled(model);

        self.textures.back.bind();
        glm.mat4.rotateY(model, glm.mat4.create(), Math.PI);
        drawScaled(model);

        self.textures.left.bind();
        glm.mat4.rotateY(model, glm.mat4.create(), Math.PI/2);
        drawScaled(model);

        self.textures.right.bind();
        glm.mat4.rotateY(model, glm.mat4.create(), -Math.PI/2);
        drawScaled(model);

        self.textures.top.bind();
        glm.mat4.rotateX(model, glm.mat4.create(), Math.PI/2);
        drawScaled(model);

        self.textures.bottom.bind();
        glm.mat4.rotateX(model, glm.mat4.create(), -Math.PI/2);
        drawScaled(model);
    };


    self.initialize();
};


function buildQuad(gl, program) {
    var position = [
        -1, -1, -1,
         1, -1, -1,
         1,  1, -1,
        -1, -1, -1,
         1,  1, -1,
        -1,  1, -1,
    ];
    var uv = [
        0, 0,
        1, 0,
        1, 1,
        0, 0,
        1, 1,
        0, 1
    ];
    var attribs = webgl.buildAttribs(gl, {aPosition: 3, aUV: 2});
    attribs.aPosition.buffer.set(new Float32Array(position));
    attribs.aUV.buffer.set(new Float32Array(uv));
    var count = position.length / 9;
    var renderable = new webgl.Renderable(gl, program, attribs, count);
    return renderable;
}
