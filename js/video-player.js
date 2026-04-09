/**
 * Video Player - handles video loading, canvas rendering, playback controls
 */

class VideoPlayer {
    constructor() {
        this.video = document.getElementById('source-video');
        this.canvas = document.getElementById('preview-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.overlayCanvas = document.getElementById('overlay-canvas');
        this.overlayCtx = this.overlayCanvas.getContext('2d');
        this.canvasContainer = document.getElementById('canvas-container');
        this.dropZone = document.getElementById('drop-zone');

        this.isPlaying = false;
        this.animFrameId = null;
        this.loaded = false;

        this._initDropZone();
        this._initPlaybackControls();
        this._initKeyboard();
    }

    _initDropZone() {
        const dropZone = this.dropZone;
        const container = this.canvasContainer;

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });
        container.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        });
        container.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('video/')) {
                this.loadFile(file);
            }
        });

        // Click to import
        dropZone.addEventListener('click', () => {
            document.getElementById('file-input').click();
        });
    }

    _initPlaybackControls() {
        const btnPlay = document.getElementById('btn-play');
        const seekBar = document.getElementById('seek-bar');
        const speedSelect = document.getElementById('playback-speed');

        btnPlay.addEventListener('click', () => this.togglePlay());

        seekBar.addEventListener('input', () => {
            if (!this.loaded) return;
            const t = (seekBar.value / 1000) * this.video.duration;
            this.video.currentTime = t;
            if (!this.isPlaying) this._drawFrame();
        });

        speedSelect.addEventListener('change', () => {
            this.video.playbackRate = parseFloat(speedSelect.value);
        });

        this.video.addEventListener('ended', () => {
            this.pause();
        });
    }

    _initKeyboard() {
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
            if (e.code === 'Space') {
                e.preventDefault();
                this.togglePlay();
            }
            if (e.code === 'ArrowLeft') {
                e.preventDefault();
                this.video.currentTime = Math.max(0, this.video.currentTime - 1 / 30);
                if (!this.isPlaying) this._drawFrame();
            }
            if (e.code === 'ArrowRight') {
                e.preventDefault();
                this.video.currentTime = Math.min(this.video.duration, this.video.currentTime + 1 / 30);
                if (!this.isPlaying) this._drawFrame();
            }
        });
    }

    loadFile(file) {
        const url = URL.createObjectURL(file);
        this.video.src = url;
        this.video.onloadedmetadata = () => {
            this.loaded = true;
            this._setupCanvas();
            this.dropZone.classList.add('hidden');
            document.getElementById('playback-controls').style.display = 'flex';
            document.getElementById('timeline-section').style.display = 'flex';
            document.getElementById('btn-export').disabled = false;

            // Video info
            const info = `${this.video.videoWidth}x${this.video.videoHeight} | ${this.video.duration.toFixed(1)}s`;
            document.getElementById('video-info').textContent = info;
            document.getElementById('time-duration').textContent = this._formatTime(this.video.duration);

            // Notify app (must happen BEFORE drawFrame so segments are initialized)
            if (window.app) window.app.onVideoLoaded();

            // Ensure first frame is drawn (wait for video to be ready)
            this.video.currentTime = 0;
            this.video.onseeked = () => {
                this._drawFrame();
                this.video.onseeked = null;
            };
            // Fallback if onseeked doesn't fire (already at 0)
            setTimeout(() => this._drawFrame(), 100);
        };
    }

    _setupCanvas() {
        const vw = this.video.videoWidth;
        const vh = this.video.videoHeight;
        this.canvas.width = vw;
        this.canvas.height = vh;
        this.overlayCanvas.width = vw;
        this.overlayCanvas.height = vh;

        // Match display size
        this._resizeCanvasDisplay();
        window.addEventListener('resize', () => this._resizeCanvasDisplay());
    }

    _resizeCanvasDisplay() {
        const container = this.canvasContainer;
        const containerW = container.clientWidth;
        const containerH = container.clientHeight;
        const vw = this.video.videoWidth;
        const vh = this.video.videoHeight;

        const scale = Math.min(containerW / vw, containerH / vh);
        const displayW = Math.floor(vw * scale);
        const displayH = Math.floor(vh * scale);

        this.canvas.style.width = displayW + 'px';
        this.canvas.style.height = displayH + 'px';
        this.overlayCanvas.style.width = displayW + 'px';
        this.overlayCanvas.style.height = displayH + 'px';

        this.displayScale = scale;
        this.displayOffsetX = (containerW - displayW) / 2;
        this.displayOffsetY = (containerH - displayH) / 2;
    }

    togglePlay() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    play() {
        if (!this.loaded) return;
        this.video.play();
        this.isPlaying = true;
        document.getElementById('icon-play').style.display = 'none';
        document.getElementById('icon-pause').style.display = 'block';
        this._startRenderLoop();
    }

    pause() {
        this.video.pause();
        this.isPlaying = false;
        document.getElementById('icon-play').style.display = 'block';
        document.getElementById('icon-pause').style.display = 'none';
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    _startRenderLoop() {
        const loop = () => {
            if (!this.isPlaying) return;

            // If playing and outside a segment, skip to next segment
            const currentSeg = this._getCurrentSegment(this.video.currentTime);
            if (!currentSeg) {
                const nextSeg = this._getNextSegment(this.video.currentTime);
                if (nextSeg) {
                    this.video.currentTime = nextSeg.startTime;
                } else {
                    this.pause();
                    return;
                }
            } else {
                // Apply per-segment speed
                const segSpeed = currentSeg.speed || 1;
                if (this.video.playbackRate !== segSpeed) {
                    this.video.playbackRate = segSpeed;
                }
            }

            this._drawFrame();
            this._updateTimeDisplay();
            this.animFrameId = requestAnimationFrame(loop);
        };
        this.animFrameId = requestAnimationFrame(loop);
    }

    /**
     * Get the segment containing currentTime
     */
    _getCurrentSegment(currentTime) {
        const segments = window.app ? window.app.state.videoSegments : [];
        if (!segments || segments.length === 0) return null;
        for (const seg of segments) {
            if (currentTime >= seg.startTime && currentTime <= seg.endTime) return seg;
        }
        return null;
    }

    /**
     * Get the next segment after given time
     */
    _getNextSegment(currentTime) {
        const segments = window.app ? window.app.state.videoSegments : [];
        if (!segments || segments.length === 0) return null;
        const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);
        for (const seg of sorted) {
            if (seg.startTime > currentTime) return seg;
        }
        return null;
    }

    /**
     * Check if currentTime falls within any video segment
     */
    _isInVideoSegment(currentTime) {
        const segments = window.app ? window.app.state.videoSegments : [];
        if (!segments || segments.length === 0) return true; // no segments = show all
        for (const seg of segments) {
            if (currentTime >= seg.startTime && currentTime <= seg.endTime) {
                return true;
            }
        }
        return false;
    }

    _drawFrame() {
        if (!this.loaded) return;
        const ctx = this.ctx;
        const canvas = this.canvas;
        const video = this.video;
        const currentTime = video.currentTime;

        // Check if current time is within a video segment
        if (!this._isInVideoSegment(currentTime)) {
            // Outside any segment = black screen
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            this._updateTimeDisplay();
            if (window.timeline) {
                window.timeline.updatePlayhead(currentTime);
            }
            return;
        }

        // Draw base video frame
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Apply effects (pass playback speed so zoom transitions stay constant)
        const tracks = window.app ? window.app.state.tracks : [];
        const speed = video.playbackRate || 1;
        window.effectsEngine.renderFrame(ctx, video, canvas, tracks, currentTime, speed);

        this._updateTimeDisplay();

        // Update timeline playhead
        if (window.timeline) {
            window.timeline.updatePlayhead(currentTime);
        }
    }

    _updateTimeDisplay() {
        const current = this.video.currentTime;
        const duration = this.video.duration || 0;
        document.getElementById('time-current').textContent = this._formatTime(current);
        document.getElementById('seek-bar').value = duration ? (current / duration) * 1000 : 0;
    }

    _formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
    }

    /**
     * Seek to specific time
     */
    seekTo(time) {
        this.video.currentTime = time;
        if (!this.isPlaying) {
            this._drawFrame();
        }
    }

    /**
     * Get canvas-relative coordinates from mouse event
     */
    getCanvasCoords(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    }

    /**
     * Force redraw current frame (called when effects change)
     */
    redraw() {
        if (!this.isPlaying) {
            this._drawFrame();
        }
    }
}

window.VideoPlayer = VideoPlayer;
