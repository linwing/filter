"use strict";
function Swift(canvas) {
    var gl = canvas.getContext("webgl");
    gl.enable(gl.CULL_FACE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    this.canvas = canvas;
    this.gl = gl;
    this.source = null;
    this.filters = [];
    this.framebufferTexture = [];
    this.i = 0;
    this.count = 0;
    this.vertexBuffer = this.setVertexBuffer();
}
Swift.prototype = {
    constructor: Swift,
    gaussianBlur: function (radius) {
        var filter = new GaussianBlur(this, radius);
        this.count += filter.count;
        this.filters.push(filter);
        return this;
    },
    test: function () {
        var filter = new Test(this);
        this.count += filter.count;
        this.filters.push(filter);
        return this;
    },
    applyTo: function (image) {
        var gl = this.gl;
        this.canvas.width = image.naturalWidth;
        this.canvas.height = image.naturalHeight;
        this.source = this.createTexture();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
        this.filters.forEach(function (filter) {
            filter.draw();
        });
    },
    draw: function () {
        var gl = this.gl;
        var framebuffer, texture;
        if (this.i === 0) {
            texture = this.source;
        }
        else {
            texture = this.getFramebufferTexture((this.i - 1) % 2).texture;
        }
        if (this.i === this.count - 1) {
            framebuffer = null;
        }
        else {
            framebuffer = this.getFramebufferTexture(this.i % 2).framebuffer;
        }
        this.i++;
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    setVertexBuffer: function () {
        var gl = this.gl;
        var buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            1, 1, 1, 1,
            -1, 1, 0, 1,
            1, -1, 1, 0,
            -1, -1, 0, 0
        ]), gl.STATIC_DRAW);
    },
    getFramebufferTexture: function (i) {
        return this.framebufferTexture[i] || this.createFramebufferTexture(i);
    },
    createFramebufferTexture: function (index) {
        var gl = this.gl;
        var canvas = this.canvas;
        var texture = this.createTexture();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, canvas.width, canvas.height, 0, gl.RGB, gl.UNSIGNED_BYTE, null);
        var framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        var pair = {
            framebuffer: framebuffer,
            texture: texture
        };
        this.framebufferTexture[index] = pair;
        return pair;
    },
    createTexture: function () {
        var gl = this.gl;
        var texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return texture;
    },
    createShader: function (type, source) {
        var gl = this.gl;
        var shader = gl.createShader(gl[type]);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        return shader;
    },
    createProgram: function (vSource, fSource) {
        var gl = this.gl;
        var program = gl.createProgram();
        gl.attachShader(program, this.createShader("VERTEX_SHADER", vSource));
        gl.attachShader(program, this.createShader("FRAGMENT_SHADER", fSource));
        gl.linkProgram(program);
        return program;
    }
};
function GaussianBlur(swift, radius) {
    this.program = swift.createProgram(this.vSource, this.createFSource(radius));
    this.swift = swift;
    this.radius = radius;
}
GaussianBlur.prototype = {
    constructor: GaussianBlur,
    vSource: `
        attribute vec2 aPosition;
        attribute vec2 aTexCoord;
        varying vec2 vTexCoord;
        void main() {
            gl_Position = vec4(aPosition, 0, 1);
            vTexCoord = aTexCoord;
        }
    `,
    count: 2,
    draw: function () {
        var swift = this.swift;
        var gl = swift.gl;
        var program = this.program;
        gl.useProgram(program);
        this.setTexCoord();
        var uPx = gl.getUniformLocation(program, "uPx");
        gl.uniform2f(uPx, 0, 1 / swift.canvas.height);
        swift.draw();
        gl.uniform2f(uPx, 1 / swift.canvas.width, 0);
        swift.draw();
    },
    setTexCoord: function () {
        var swift = this.swift;
        var gl = swift.gl;
        var program = this.program;
        var aPosition = gl.getAttribLocation(program, "aPosition");
        gl.enableVertexAttribArray(aPosition);
        gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 16, 0);
        var aTexCoord = gl.getAttribLocation(program, "aTexCoord");
        gl.enableVertexAttribArray(aTexCoord);
        gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, 16, 8);
    },
    createFSource: function (r) {
        var sigma = r / 3;
        var weights = [];
        for (var i = 0; i < r + 1; i++) {
            weights.push(this.gaussian(i, sigma));
        }
        var total = weights.reduce(function (a, b) {
            return a + b;
        });
        total *= 2;
        weights = weights.map(function (weight) {
            return weight / total;
        });
        var fSource = `
            precision highp float;
            varying vec2 vTexCoord;
            uniform sampler2D uSampler;
            uniform vec2 uPx;
            void main() {
                gl_FragColor = vec4(0.0);
        `;
        for (var i = -r; i < 0; i++) {
            fSource += `gl_FragColor += texture2D(uSampler, vTexCoord + ${i}.0 * uPx) * ${weights[-i]};\n`;
        }
        for (var i = 0; i < r + 1; i++) {
            fSource += `gl_FragColor += texture2D(uSampler, vTexCoord + ${i}.0 * uPx) * ${weights[i]};\n`;
        }
        fSource += `}`;
        return fSource;
    },
    gaussian: function (r, sigma) {
        return 1 / Math.sqrt(2 * Math.PI) / sigma * Math.pow(Math.E, -r * r / 2 / sigma / sigma);
    }
};
function Test(swift) {
    this.swift = swift;
    this.program = swift.createProgram(this.vSource, this.fSource);
}
Test.prototype = {
    constructor: Test,
    vSource: GaussianBlur.prototype.vSource,
    fSource:`
        precision highp float;
        varying vec2 vTexCoord;
        uniform sampler2D uSampler;
        void main() {
            gl_FragColor = texture2D(uSampler, vTexCoord);
        }
    `,
    setTexCoord: GaussianBlur.prototype.setTexCoord,
    count: 1,
    draw: function () {
        var swift = this.swift;
        var gl = swift.gl;
        var program = this.program;
        gl.useProgram(program);
        this.setTexCoord();
        swift.draw();
    }
};