import { Texture2D, resizeTexture, disposeTexture, createEmptyTexture } from './texture2d';
import { array } from '../../common/utils';

export interface FBOOptions {
	/* Upgrade to floating point if available, otherwise fallback to 8bit. (default false) */
	preferFloat?: boolean;
	/* Use floating point textures (default false) */
	float?: boolean;
	/* The number of color buffers to create (default 1) */
	color?: number;
	/* If fbo has a depth buffer (default: true) */
	depth?: boolean;
	/* If fbo has a stencil buffer (default: false) */
	stencil?: boolean;
}

type WebGL = WebGLRenderingContext;
type FBOState = [WebGLFramebuffer | null, WebGLRenderbuffer | null, WebGLTexture | null];

let colorAttachmentArrays: number[][] | null = null;

export interface FrameBuffer {
	color: (Texture2D | undefined)[];
	depth: Texture2D | undefined;
	handle: WebGLFramebuffer | null;
	colorRenderBuffer: WebGLRenderbuffer | null;
	depthRenderBuffer: WebGLRenderbuffer | null;
	width: number;
	height: number;
	gl: WebGLRenderingContext;
	colorType: number;
	useDepth: boolean;
	useStencil: boolean;
	ext: WEBGL_draw_buffers | null;
}

export function createFrameBuffer(gl: WebGL, width: number, height: number, options: FBOOptions = {}): FrameBuffer {
	const { color = 1, depth = true, stencil = false, float = false, preferFloat = false } = options;
	const ext = gl.getExtension('WEBGL_draw_buffers');

	width = width | 0;
	height = height | 0;

	if (!colorAttachmentArrays && ext) {
		lazyInitColorAttachments(gl, ext);
	}

	const maxFBOSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);

	if (maxFBOSize != null && (width < 0 || width > maxFBOSize || height < 0 || height > maxFBOSize)) {
		throw new Error('Parameters are too large for FBO');
	}

	const numColors = Math.max(color, 0);

	if (numColors < 0) {
		throw new Error('Must specify a nonnegative number of colors');
	} else if (numColors > 1) {
		if (!ext) {
			throw new Error('Multiple draw buffer extension not supported');
		} else if (numColors > gl.getParameter(ext.MAX_COLOR_ATTACHMENTS_WEBGL)) {
			throw new Error(`Context does not support ${numColors} draw buffers`);
		}
	}

	let colorType = gl.UNSIGNED_BYTE;
	const OES_texture_float = gl.getExtension('OES_texture_float');

	if (float && numColors > 0) {
		if (!OES_texture_float) {
			throw new Error('Context does not support floating point textures');
		}

		colorType = gl.FLOAT;
	} else if (preferFloat && numColors > 0) {
		if (OES_texture_float) {
			colorType = gl.FLOAT;
		}
	}

	const fbo: FrameBuffer = {
		gl, width, height, colorType, color: array(numColors, undefined), useDepth: depth, useStencil: stencil, ext,
		colorRenderBuffer: null, depth: undefined, depthRenderBuffer: null, handle: null,
	};

	rebuild(fbo);
	return fbo;
}

export function resizeFrameBuffer(fbo: FrameBuffer, w: number, h: number) {
	if (fbo.width === w && fbo.height === h) {
		return;
	}

	const gl = fbo.gl;
	const maxFBOSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);

	if (maxFBOSize != null && (w < 0 || w > maxFBOSize || h < 0 || h > maxFBOSize)) {
		throw new Error(`Can't resize FBO, invalid dimensions`);
	}

	fbo.width = w;
	fbo.height = h;

	const state = saveFBOState(gl);

	for (const color of fbo.color) {
		if (color) {
			resizeTexture(gl, color, w, h);
		}
	}

	if (fbo.colorRenderBuffer) {
		gl.bindRenderbuffer(gl.RENDERBUFFER, fbo.colorRenderBuffer);
		gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA4, w, h);
	}

	if (fbo.depth) {
		resizeTexture(gl, fbo.depth, w, h);
	}

	if (fbo.depthRenderBuffer) {
		gl.bindRenderbuffer(gl.RENDERBUFFER, fbo.depthRenderBuffer);

		if (fbo.useDepth && fbo.useStencil) {
			gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, w, h);
		} else if (fbo.useDepth) {
			gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
		} else if (fbo.useStencil) {
			gl.renderbufferStorage(gl.RENDERBUFFER, gl.STENCIL_INDEX8, w, h);
		}
	}

	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.handle);
	const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);

	if (status !== gl.FRAMEBUFFER_COMPLETE) {
		disposeFrameBuffer(fbo);
		restoreFBOState(gl, state);
		throwFBOError(gl, status, `reshape(${w}, ${h})`);
	}

	restoreFBOState(gl, state);
}

export function bindFrameBuffer(fbo: FrameBuffer) {
	fbo.gl.bindFramebuffer(fbo.gl.FRAMEBUFFER, fbo.handle);
	fbo.gl.viewport(0, 0, fbo.width, fbo.height);
}

export function disposeFrameBuffer(fbo: FrameBuffer | undefined): undefined {
	if (fbo) {
		fbo.gl.deleteFramebuffer(fbo.handle);
		fbo.handle = null;
		fbo.depth = disposeTexture(fbo.gl, fbo.depth);

		if (fbo.depthRenderBuffer) {
			fbo.gl.deleteRenderbuffer(fbo.depthRenderBuffer);
			fbo.depthRenderBuffer = null;
		}

		for (let i = 0; i < fbo.color.length; i++) {
			fbo.color[i] = disposeTexture(fbo.gl, fbo.color[i]);
		}

		if (fbo.colorRenderBuffer) {
			fbo.gl.deleteRenderbuffer(fbo.colorRenderBuffer);
			fbo.colorRenderBuffer = null;
		}
	}

	return undefined;
}

function rebuild(fbo: FrameBuffer) {
	const state = saveFBOState(fbo.gl);
	const gl = fbo.gl;
	const handle = fbo.handle = gl.createFramebuffer();
	const numColors = fbo.color.length;
	const { width, height, ext, useStencil, useDepth, colorType } = fbo;

	gl.bindFramebuffer(gl.FRAMEBUFFER, handle);

	for (let i = 0; i < numColors; ++i) {
		fbo.color[i] = initTexture(gl, width, height, colorType, gl.RGBA, gl.COLOR_ATTACHMENT0 + i);
	}

	if (numColors === 0) {
		fbo.colorRenderBuffer = initRenderBuffer(gl, width, height, gl.RGBA4, gl.COLOR_ATTACHMENT0);

		if (ext) {
			ext.drawBuffersWEBGL(colorAttachmentArrays![0]);
		}
	} else if (numColors > 1) {
		if (ext) {
			ext.drawBuffersWEBGL(colorAttachmentArrays![numColors]);
		}
	}

	const WEBGL_depth_texture = gl.getExtension('WEBGL_depth_texture');

	if (WEBGL_depth_texture) {
		if (useStencil) {
			fbo.depth = initTexture(
				gl, width, height, WEBGL_depth_texture.UNSIGNED_INT_24_8_WEBGL, gl.DEPTH_STENCIL, gl.DEPTH_STENCIL_ATTACHMENT);
		} else if (useDepth) {
			fbo.depth = initTexture(gl, width, height, gl.UNSIGNED_SHORT, gl.DEPTH_COMPONENT, gl.DEPTH_ATTACHMENT);
		}
	} else {
		if (useDepth && useStencil) {
			fbo.depthRenderBuffer = initRenderBuffer(gl, width, height, gl.DEPTH_STENCIL, gl.DEPTH_STENCIL_ATTACHMENT);
		} else if (useDepth) {
			fbo.depthRenderBuffer = initRenderBuffer(gl, width, height, gl.DEPTH_COMPONENT16, gl.DEPTH_ATTACHMENT);
		} else if (useStencil) {
			fbo.depthRenderBuffer = initRenderBuffer(gl, width, height, gl.STENCIL_INDEX8, gl.STENCIL_ATTACHMENT);
		}
	}

	const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);

	if (status !== gl.FRAMEBUFFER_COMPLETE) {
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.deleteFramebuffer(fbo.handle);
		fbo.handle = null;
		fbo.depth = disposeTexture(gl, fbo.depth);

		if (fbo.depthRenderBuffer) {
			gl.deleteRenderbuffer(fbo.depthRenderBuffer);
			fbo.depthRenderBuffer = null;
		}

		for (let i = 0; i < fbo.color.length; i++) {
			fbo.color[i] = disposeTexture(gl, fbo.color[i]);
		}

		if (fbo.colorRenderBuffer) {
			gl.deleteRenderbuffer(fbo.colorRenderBuffer);
			fbo.colorRenderBuffer = null;
		}

		restoreFBOState(gl, state);
		throwFBOError(gl, status);
	}

	restoreFBOState(gl, state);
}

function saveFBOState(gl: WebGL): FBOState {
	const fbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
	const rbo = gl.getParameter(gl.RENDERBUFFER_BINDING);
	const tex = gl.getParameter(gl.TEXTURE_BINDING_2D);
	return [fbo, rbo, tex];
}

function restoreFBOState(gl: WebGL, [fbo, rbo, tex]: FBOState) {
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	gl.bindRenderbuffer(gl.RENDERBUFFER, rbo);
	gl.bindTexture(gl.TEXTURE_2D, tex);
}

function lazyInitColorAttachments(gl: WebGL, ext: WEBGL_draw_buffers) {
	const maxColorAttachments = gl.getParameter(ext.MAX_COLOR_ATTACHMENTS_WEBGL);
	colorAttachmentArrays = [];

	for (let i = 0; i <= maxColorAttachments; ++i) {
		const x: number[] = [];

		for (let j = 0; j < i; ++j) {
			x.push(gl.COLOR_ATTACHMENT0 + j);
		}

		for (let j = i; j < maxColorAttachments; ++j) {
			x.push(gl.NONE);
		}

		colorAttachmentArrays.push(x);
	}
}

function throwFBOError(gl: WebGL, status: number, message = '') {
	switch (status) {
		case gl.FRAMEBUFFER_UNSUPPORTED:
			throw new Error('Framebuffer unsupported');
		case gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT:
			throw new Error('Framebuffer incomplete attachment');
		case gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS:
			throw new Error('Framebuffer incomplete dimensions');
		case gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT:
			throw new Error('Framebuffer incomplete missing attachment');
		default:
			throw new Error(`Framebuffer failed for unspecified reason [${status}] (${message})`);
	}
}

function initTexture(gl: WebGL, width: number, height: number, type: number, format: number, attachment: number) {
	const texture = createEmptyTexture(gl, true, width, height, format, type);
	if (texture) {
		gl.bindTexture(gl.TEXTURE_2D, texture.handle);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, texture.handle, 0);
	}
	return texture;
}

function initRenderBuffer(gl: WebGL, width: number, height: number, component: number, attachment: number) {
	const result = gl.createRenderbuffer();
	gl.bindRenderbuffer(gl.RENDERBUFFER, result);
	gl.renderbufferStorage(gl.RENDERBUFFER, component, width, height);
	gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, result);
	return result;
}
