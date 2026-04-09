/**
 * Exporter - Export video with effects to MP4
 * Records canvas as WebM, then converts to MP4 using FFmpeg WASM
 */

class Exporter {
    constructor() {
        this.isExporting = false;
        this.mediaRecorder = null;
        this.chunks = [];
        this.ffmpeg = null;
        this.ffmpegLoaded = false;

        this._initUI();
    }

    _initUI() {
        document.getElementById('btn-export').addEventListener('click', () => this.showModal());
        document.getElementById('btn-cancel-export').addEventListener('click', () => this.hideModal());
        document.getElementById('btn-start-export').addEventListener('click', () => this.startExport());
        document.getElementById('export-modal').addEventListener('click', (e) => {
            if (e.target.id === 'export-modal') this.hideModal();
        });
    }

    showModal() {
        document.getElementById('export-modal').style.display = 'flex';
        document.getElementById('export-progress').style.display = 'none';
        document.getElementById('btn-start-export').disabled = false;
    }

    hideModal() {
        if (this.isExporting) return;
        document.getElementById('export-modal').style.display = 'none';
    }

    async _loadFFmpeg() {
        if (this.ffmpegLoaded) return true;

        try {
            this._updateStatus('Loading FFmpeg...');
            const { FFmpeg } = FFmpegWASM;
            this.ffmpeg = new FFmpeg();

            this.ffmpeg.on('progress', ({ progress }) => {
                this._updateProgress(70 + progress * 25); // 70-95% for conversion
                this._updateStatus(`Converting to MP4... ${Math.round(progress * 100)}%`);
            });

            await this.ffmpeg.load({
                coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
                wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
            });

            this.ffmpegLoaded = true;
            return true;
        } catch (e) {
            console.warn('FFmpeg load failed, will export as WebM:', e);
            return false;
        }
    }

    async startExport() {
        if (this.isExporting) return;
        this.isExporting = true;
        this.chunks = [];

        const video = window.videoPlayer.video;
        const canvas = window.videoPlayer.canvas;
        const ctx = window.videoPlayer.ctx;
        const tracks = window.app.state.tracks;

        const resolution = document.getElementById('export-resolution').value;
        const bitrate = parseInt(document.getElementById('export-quality').value);

        let exportCanvas = canvas;
        let exportCtx = ctx;
        let exportW = video.videoWidth;
        let exportH = video.videoHeight;

        if (resolution !== 'original') {
            const h = parseInt(resolution);
            const aspect = video.videoWidth / video.videoHeight;
            exportW = Math.round(h * aspect);
            exportH = h;
            exportCanvas = document.createElement('canvas');
            exportCanvas.width = exportW;
            exportCanvas.height = exportH;
            exportCtx = exportCanvas.getContext('2d');
        }

        document.getElementById('export-progress').style.display = 'block';
        document.getElementById('btn-start-export').disabled = true;
        this._updateProgress(0);
        this._updateStatus('Recording frames...');

        // Record canvas as WebM
        const stream = exportCanvas.captureStream(30);
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
            ? 'video/webm;codecs=vp9'
            : 'video/webm';

        this.mediaRecorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: bitrate
        });

        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) this.chunks.push(e.data);
        };

        // Wait for recording to finish
        const recordingDone = new Promise(resolve => {
            this.mediaRecorder.onstop = resolve;
        });

        this.mediaRecorder.start(100);

        // Render all frames
        video.currentTime = 0;
        video.playbackRate = 1;
        await new Promise(resolve => { video.onseeked = resolve; });

        const duration = video.duration;
        const fps = 30;
        const frameTime = 1 / fps;
        let currentTime = 0;

        await new Promise((resolve) => {
            const renderNextFrame = () => {
                if (currentTime >= duration || !this.isExporting) {
                    this.mediaRecorder.stop();
                    window.videoPlayer.pause();
                    resolve();
                    return;
                }

                video.currentTime = currentTime;
                video.onseeked = () => {
                    exportCtx.drawImage(video, 0, 0, exportCanvas.width, exportCanvas.height);
                    window.effectsEngine.renderFrame(exportCtx, video, exportCanvas, tracks, currentTime, 1);

                    currentTime += frameTime;
                    this._updateProgress((currentTime / duration) * 65); // 0-65% for recording
                    this._updateStatus(`Recording... ${Math.round((currentTime / duration) * 100)}%`);

                    setTimeout(renderNextFrame, 0);
                };
            };
            renderNextFrame();
        });

        await recordingDone;
        this._updateProgress(68);
        this._updateStatus('Preparing video data...');

        const webmBlob = new Blob(this.chunks, { type: mimeType });

        // Try to convert to MP4 with FFmpeg
        const canMP4 = await this._loadFFmpeg();

        if (canMP4 && this.ffmpeg) {
            try {
                this._updateProgress(72);
                this._updateStatus('Converting to MP4...');

                const { fetchFile } = FFmpegUtil;
                const webmData = await fetchFile(webmBlob);
                await this.ffmpeg.writeFile('input.webm', webmData);

                await this.ffmpeg.exec([
                    '-i', 'input.webm',
                    '-c:v', 'libx264',
                    '-preset', 'fast',
                    '-crf', '23',
                    '-pix_fmt', 'yuv420p',
                    '-movflags', '+faststart',
                    'output.mp4'
                ]);

                const mp4Data = await this.ffmpeg.readFile('output.mp4');
                const mp4Blob = new Blob([mp4Data.buffer], { type: 'video/mp4' });

                this._downloadFile(mp4Blob, 'video-export.mp4');
                this._updateProgress(100);
                this._updateStatus('Export complete! (MP4)');
            } catch (e) {
                console.warn('MP4 conversion failed, downloading WebM:', e);
                this._downloadFile(webmBlob, 'video-export.webm');
                this._updateStatus('Export complete! (WebM - MP4 conversion failed)');
            }
        } else {
            // Fallback to WebM
            this._downloadFile(webmBlob, 'video-export.webm');
            this._updateProgress(100);
            this._updateStatus('Export complete! (WebM)');
        }

        this.isExporting = false;
        // Clean up ffmpeg files
        try {
            if (this.ffmpeg) {
                await this.ffmpeg.deleteFile('input.webm').catch(() => {});
                await this.ffmpeg.deleteFile('output.mp4').catch(() => {});
            }
        } catch (e) {}

        setTimeout(() => this.hideModal(), 2000);
    }

    _downloadFile(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    _updateProgress(percent) {
        const fill = document.getElementById('export-progress-fill');
        const text = document.getElementById('export-progress-text');
        fill.style.width = Math.min(100, percent) + '%';
        text.textContent = Math.round(percent) + '%';
    }

    _updateStatus(msg) {
        const text = document.getElementById('export-progress-text');
        if (text) text.textContent = msg;
    }
}

window.Exporter = Exporter;
