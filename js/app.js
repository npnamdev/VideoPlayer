/**
 * App - Main application, state management, region drawing, properties panel
 */

class App {
    constructor() {
        this.state = {
            tracks: [],
            videoSegments: [],
            selectedClipId: null,
            selectedTrackId: null,
            selectedSegId: null, // selected video segment
            nextTrackId: 1,
            nextClipId: 1
        };

        // Region editor state
        this.regionDrag = null; // { type: 'move'|'tl'|'tr'|'bl'|'br'|'t'|'b'|'l'|'r', startCoords, origRegion }
        this.handleRadius = 6;

        // Initialize modules
        window.videoPlayer = new VideoPlayer();
        window.timeline = new Timeline();
        window.exporter = new Exporter();

        this._initWelcome();
        this._initToolbar();
        this._initRegionEditor();
    }

    _initWelcome() {
        const welcomeScreen = document.getElementById('welcome-screen');
        const welcomeDropZone = document.getElementById('welcome-drop-zone');
        const btnImportWelcome = document.getElementById('btn-import-welcome');

        btnImportWelcome.addEventListener('click', () => {
            document.getElementById('file-input').click();
        });

        welcomeDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            welcomeDropZone.classList.add('drag-over');
        });
        welcomeDropZone.addEventListener('dragleave', () => {
            welcomeDropZone.classList.remove('drag-over');
        });
        welcomeDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            welcomeDropZone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('video/')) {
                this._loadVideoFile(file);
            }
        });
    }

    _loadVideoFile(file) {
        document.getElementById('welcome-screen').style.display = 'none';
        document.getElementById('editor-ui').style.display = 'flex';
        window.videoPlayer.loadFile(file);
    }

    _initToolbar() {
        document.getElementById('btn-import').addEventListener('click', () => {
            document.getElementById('file-input').click();
        });
        document.getElementById('file-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) this._loadVideoFile(file);
        });

        // These buttons ADD A CLIP at playhead position (not just a track)
        document.getElementById('btn-add-zoom').addEventListener('click', () => this._addEffectAtPlayhead('zoom'));
        document.getElementById('btn-add-highlight').addEventListener('click', () => this._addEffectAtPlayhead('highlight'));
        document.getElementById('btn-add-text').addEventListener('click', () => this._addEffectAtPlayhead('text'));
    }

    /**
     * Add effect clip at current playhead position.
     * Creates track if needed, then adds clip and auto-selects it.
     */
    _addEffectAtPlayhead(type) {
        if (!window.videoPlayer || !window.videoPlayer.loaded) return;

        const currentTime = window.videoPlayer.video.currentTime;
        const duration = window.videoPlayer.video.duration;

        // Find existing track of this type, or create one
        let track = this.state.tracks.find(t => t.type === type);
        if (!track) {
            track = this._createTrack(type);
        }

        // Default clip: 3 seconds from playhead (or to end of video)
        const clipDuration = Math.min(3, duration - currentTime);
        if (clipDuration < 0.1) return;

        const clip = this.addClip(track.id, currentTime, currentTime + clipDuration);
        if (!clip) return;

        // Pause video and force redraw at current position so zoom shows immediately
        window.videoPlayer.pause();
        window.videoPlayer.seekTo(currentTime);
        // Small delay to ensure video frame is decoded then redraw with effects
        setTimeout(() => {
            window.videoPlayer.redraw();
            this._showRegionEditor();
        }, 50);
    }

    // ========== Interactive Region Editor ==========

    _initRegionEditor() {
        const overlay = document.getElementById('overlay-canvas');
        // NOT active by default - only when a region clip is selected
        overlay.addEventListener('mousedown', (e) => this._onOverlayMouseDown(e));
        overlay.addEventListener('mousemove', (e) => this._onOverlayMouseMove(e));
        overlay.addEventListener('mouseup', (e) => this._onOverlayMouseUp(e));
        overlay.addEventListener('mouseleave', (e) => this._onOverlayMouseUp(e));
    }

    /**
     * Enable/disable overlay interaction based on selected clip
     */
    _updateOverlayActive() {
        const overlay = document.getElementById('overlay-canvas');
        const hasRegion = this._getActiveRegionClip() !== null;
        if (hasRegion) {
            overlay.style.pointerEvents = 'auto';
        } else {
            overlay.style.pointerEvents = 'none';
        }
    }

    _getActiveRegionClip() {
        const clip = this.getSelectedClip();
        if (!clip) return null;
        const track = this.getTrackForClip(clip.id);
        if (!track) return null;
        // Only highlight uses the interactive overlay handles
        // Zoom uses the minimap in properties panel instead
        if (track.type === 'highlight') return clip;
        return null;
    }

    /**
     * Get zoom clip for simple overlay indicator (non-interactive)
     */
    _getZoomClipForOverlay() {
        const clip = this.getSelectedClip();
        if (!clip) return null;
        const track = this.getTrackForClip(clip.id);
        if (!track) return null;
        if (track.type === 'zoom') return clip;
        return null;
    }

    _getRegionColor() {
        const clip = this.getSelectedClip();
        if (!clip) return '#fff';
        const track = this.getTrackForClip(clip.id);
        if (!track) return '#fff';
        return track.type === 'zoom' ? '#7c5ce7' : '#e74c6f';
    }

    _getHandles(clip, cw, ch) {
        const rx = clip.regionX * cw;
        const ry = clip.regionY * ch;
        const rw = clip.regionW * cw;
        const rh = clip.regionH * ch;
        return {
            tl: { x: rx, y: ry },
            tr: { x: rx + rw, y: ry },
            bl: { x: rx, y: ry + rh },
            br: { x: rx + rw, y: ry + rh },
            t:  { x: rx + rw / 2, y: ry },
            b:  { x: rx + rw / 2, y: ry + rh },
            l:  { x: rx, y: ry + rh / 2 },
            r:  { x: rx + rw, y: ry + rh / 2 },
        };
    }

    _hitTestHandle(coords, clip, cw, ch) {
        const handles = this._getHandles(clip, cw, ch);
        const r = this.handleRadius + 4; // hit area slightly larger
        const mx = coords.x * cw;
        const my = coords.y * ch;

        for (const [key, pos] of Object.entries(handles)) {
            if (Math.abs(mx - pos.x) < r && Math.abs(my - pos.y) < r) {
                return key;
            }
        }

        // Check if inside the region (for move)
        const rx = clip.regionX * cw;
        const ry = clip.regionY * ch;
        const rw = clip.regionW * cw;
        const rh = clip.regionH * ch;
        if (mx >= rx && mx <= rx + rw && my >= ry && my <= ry + rh) {
            return 'move';
        }

        return null;
    }

    _onOverlayMouseDown(e) {
        if (!window.videoPlayer || !window.videoPlayer.loaded) return;
        const clip = this._getActiveRegionClip();
        if (!clip) return;

        const coords = window.videoPlayer.getCanvasCoords(e);
        const overlay = document.getElementById('overlay-canvas');
        const cw = overlay.width;
        const ch = overlay.height;

        const hit = this._hitTestHandle(coords, clip, cw, ch);
        if (!hit) {
            // Click outside region = start drawing new region
            this.regionDrag = {
                type: 'new',
                startCoords: coords,
                origRegion: { x: clip.regionX, y: clip.regionY, w: clip.regionW, h: clip.regionH }
            };
            return;
        }

        this.regionDrag = {
            type: hit,
            startCoords: coords,
            origRegion: { x: clip.regionX, y: clip.regionY, w: clip.regionW, h: clip.regionH }
        };
    }

    _onOverlayMouseMove(e) {
        if (!window.videoPlayer || !window.videoPlayer.loaded) return;

        const clip = this._getActiveRegionClip();
        const overlay = document.getElementById('overlay-canvas');
        const cw = overlay.width;
        const ch = overlay.height;

        if (!clip) {
            if (cw && ch) {
                window.videoPlayer.overlayCtx.clearRect(0, 0, cw, ch);
            }
            overlay.style.cursor = 'default';
            return;
        }

        const coords = window.videoPlayer.getCanvasCoords(e);

        // Update cursor based on what we'd hit
        if (!this.regionDrag) {
            const hit = this._hitTestHandle(coords, clip, cw, ch);
            const cursors = {
                tl: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize', br: 'nwse-resize',
                t: 'ns-resize', b: 'ns-resize', l: 'ew-resize', r: 'ew-resize',
                move: 'move'
            };
            overlay.style.cursor = cursors[hit] || 'crosshair';
        }

        // Handle dragging
        if (this.regionDrag) {
            const dx = coords.x - this.regionDrag.startCoords.x;
            const dy = coords.y - this.regionDrag.startCoords.y;
            const orig = this.regionDrag.origRegion;
            const type = this.regionDrag.type;

            if (type === 'new') {
                // Drawing new region
                clip.regionX = Math.max(0, Math.min(this.regionDrag.startCoords.x, coords.x));
                clip.regionY = Math.max(0, Math.min(this.regionDrag.startCoords.y, coords.y));
                clip.regionW = Math.max(0.03, Math.abs(dx));
                clip.regionH = Math.max(0.03, Math.abs(dy));
            } else if (type === 'move') {
                clip.regionX = Math.max(0, Math.min(1 - orig.w, orig.x + dx));
                clip.regionY = Math.max(0, Math.min(1 - orig.h, orig.y + dy));
            } else {
                // Resize handles
                let nx = orig.x, ny = orig.y, nw = orig.w, nh = orig.h;

                if (type.includes('l')) { nx = orig.x + dx; nw = orig.w - dx; }
                if (type.includes('r')) { nw = orig.w + dx; }
                if (type.includes('t')) { ny = orig.y + dy; nh = orig.h - dy; }
                if (type.includes('b')) { nh = orig.h + dy; }

                // Enforce minimums and bounds
                if (nw < 0.03) { nw = 0.03; if (type.includes('l')) nx = orig.x + orig.w - 0.03; }
                if (nh < 0.03) { nh = 0.03; if (type.includes('t')) ny = orig.y + orig.h - 0.03; }
                nx = Math.max(0, Math.min(1 - nw, nx));
                ny = Math.max(0, Math.min(1 - nh, ny));
                nw = Math.min(nw, 1 - nx);
                nh = Math.min(nh, 1 - ny);

                clip.regionX = nx;
                clip.regionY = ny;
                clip.regionW = nw;
                clip.regionH = nh;
            }

            window.videoPlayer.redraw();
        }

        // Draw region overlay for highlight
        this._drawRegionOverlay(clip, cw, ch);
    }

    _onOverlayMouseUp(e) {
        if (this.regionDrag) {
            this.regionDrag = null;
            this._renderProperties();
            window.videoPlayer.redraw();
        }
    }

    /**
     * Draw the interactive region overlay with handles
     */
    _drawRegionOverlay(clip, cw, ch) {
        const ctx = window.videoPlayer.overlayCtx;
        ctx.clearRect(0, 0, cw, ch);

        const color = this._getRegionColor();
        const rx = clip.regionX * cw;
        const ry = clip.regionY * ch;
        const rw = clip.regionW * cw;
        const rh = clip.regionH * ch;

        // Dim outside region
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.beginPath();
        ctx.rect(0, 0, cw, ch);
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx, ry + rh);
        ctx.lineTo(rx + rw, ry + rh);
        ctx.lineTo(rx + rw, ry);
        ctx.closePath();
        ctx.fill('evenodd');

        // Region border
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.strokeRect(rx, ry, rw, rh);

        // Dashed guide lines (cross at center)
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(rx + rw / 2, ry);
        ctx.lineTo(rx + rw / 2, ry + rh);
        ctx.moveTo(rx, ry + rh / 2);
        ctx.lineTo(rx + rw, ry + rh / 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw 8 handles (corners + edge midpoints)
        const handles = this._getHandles(clip, cw, ch);
        const r = this.handleRadius;

        for (const [key, pos] of Object.entries(handles)) {
            const isCorner = key.length === 2;

            // Outer ring
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();

            // Inner dot for corners
            if (isCorner) {
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, 2.5, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
            }
        }

        // Label with dimensions
        const track = this.getTrackForClip(clip.id);
        const label = track ? (track.type === 'zoom' ? 'ZOOM' : 'HIGHLIGHT') : '';
        const pctW = Math.round(clip.regionW * 100);
        const pctH = Math.round(clip.regionH * 100);
        const labelText = `${label}  ${pctW}% x ${pctH}%`;

        ctx.font = 'bold 11px system-ui';
        const metrics = ctx.measureText(labelText);
        const labelX = rx;
        const labelY = ry - 8;

        if (labelY > 16) {
            ctx.fillStyle = color;
            const pad = 4;
            const bx = labelX - pad;
            const by = labelY - 12;
            const bw = metrics.width + pad * 2;
            const bh = 16;
            const br = 3;
            ctx.beginPath();
            ctx.moveTo(bx + br, by);
            ctx.lineTo(bx + bw - br, by);
            ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + br);
            ctx.lineTo(bx + bw, by + bh - br);
            ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - br, by + bh);
            ctx.lineTo(bx + br, by + bh);
            ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - br);
            ctx.lineTo(bx, by + br);
            ctx.quadraticCurveTo(bx, by, bx + br, by);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = '#fff';
            ctx.fillText(labelText, labelX, labelY);
        }
    }

    /**
     * Draw a simple zoom indicator (non-interactive, just visual feedback)
     */
    _drawZoomIndicator(clip, cw, ch) {
        const ctx = window.videoPlayer.overlayCtx;
        ctx.clearRect(0, 0, cw, ch);

        const rx = clip.regionX * cw;
        const ry = clip.regionY * ch;
        const rw = clip.regionW * cw;
        const rh = clip.regionH * ch;

        // Subtle dim outside
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.beginPath();
        ctx.rect(0, 0, cw, ch);
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx, ry + rh);
        ctx.lineTo(rx + rw, ry + rh);
        ctx.lineTo(rx + rw, ry);
        ctx.closePath();
        ctx.fill('evenodd');

        // Dashed border
        ctx.strokeStyle = 'rgba(124, 92, 231, 0.7)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);

        // Center dot
        const cx = rx + rw / 2;
        const cy = ry + rh / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(124, 92, 231, 0.6)';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    /**
     * Show/refresh the region editor overlay for the selected clip
     */
    _showRegionEditor() {
        if (!window.videoPlayer || !window.videoPlayer.loaded) return;
        const overlay = document.getElementById('overlay-canvas');
        const cw = overlay.width;
        const ch = overlay.height;
        if (!cw || !ch) return;

        // Highlight clip -> full interactive editor
        const highlightClip = this._getActiveRegionClip();
        if (highlightClip) {
            this._drawRegionOverlay(highlightClip, cw, ch);
            return;
        }

        // Everything else (zoom, text, nothing) -> clear overlay, no indicator
        window.videoPlayer.overlayCtx.clearRect(0, 0, cw, ch);
    }

    // ========== State Management ==========

    onVideoLoaded() {
        const duration = window.videoPlayer.video.duration;

        // Init video segments FIRST (before any drawFrame)
        if (!this.state.videoSegments || this.state.videoSegments.length === 0) {
            this.state.videoSegments = [{
                id: 'vseg_1',
                startTime: 0,
                endTime: duration,
                _minStart: 0,
                _maxEnd: duration
            }];
        }

        window.timeline.setDuration(duration);

        // Auto-create default tracks when video loads
        if (this.state.tracks.length === 0) {
            this._createTrack('zoom');
            this._createTrack('highlight');
            this._createTrack('text');
            window.timeline.render();
        }
    }

    _createTrack(type) {
        const names = { zoom: 'Zoom', highlight: 'Highlight', text: 'Text' };
        const track = {
            id: 'track_' + this.state.nextTrackId++,
            type,
            name: names[type] || type,
            clips: []
        };
        this.state.tracks.push(track);
        return track;
    }

    addTrack(type) {
        const track = this._createTrack(type);
        window.timeline.render();
        return track;
    }

    removeTrack(trackId) {
        this.state.tracks = this.state.tracks.filter(t => t.id !== trackId);
        if (this.state.selectedTrackId === trackId) {
            this.state.selectedClipId = null;
            this.state.selectedTrackId = null;
            this._renderProperties();
        }
        window.timeline.render();
        window.videoPlayer.redraw();
    }

    addClip(trackId, startTime, endTime) {
        const track = this.state.tracks.find(t => t.id === trackId);
        if (!track) return null;

        const clip = {
            id: 'clip_' + this.state.nextClipId++,
            trackId,
            startTime,
            endTime,
            transitionDuration: 0.3,
            // Zoom defaults - center region, 50% size
            regionX: 0.25,
            regionY: 0.25,
            regionW: 0.5,
            regionH: 0.5,
            // Highlight defaults
            color: '#fdcb6e',
            opacity: 0.6,
            shape: 'rectangle',
            borderWidth: 3,
            glowEnabled: true,
            // Text defaults
            text: 'Text here',
            posX: 0.05,
            posY: 0.05,
            fontSize: 36,
            fontFamily: 'Arial',
            bold: true,
            italic: false,
            bgEnabled: true,
            bgColor: 'rgba(0,0,0,0.6)'
        };

        if (track.type === 'text') {
            clip.color = '#ffffff';
        }
        if (track.type === 'highlight') {
            clip.color = '#e74c6f';
        }

        track.clips.push(clip);
        this.selectClip(clip.id);
        window.timeline.render();
        window.videoPlayer.redraw();
        return clip;
    }

    selectClip(clipId) {
        this.state.selectedClipId = clipId;
        this.state.selectedSegId = null; // deselect video segment
        const clip = this.getClipById(clipId);
        if (clip) {
            this.state.selectedTrackId = clip.trackId;
            if (window.videoPlayer && window.videoPlayer.loaded) {
                const v = window.videoPlayer.video;
                // Seek to middle of clip to show full effect preview
                const mid = (clip.startTime + clip.endTime) / 2;
                if (v.currentTime < clip.startTime || v.currentTime > clip.endTime) {
                    window.videoPlayer.seekTo(mid);
                }
            }
        }
        window.timeline.render();
        this._renderProperties();
        this._showRegionEditor();
        this._updateOverlayActive();
    }

    getClipById(clipId) {
        for (const track of this.state.tracks) {
            const clip = track.clips.find(c => c.id === clipId);
            if (clip) return clip;
        }
        return null;
    }

    getSelectedClip() {
        return this.state.selectedClipId ? this.getClipById(this.state.selectedClipId) : null;
    }

    getTrackForClip(clipId) {
        for (const track of this.state.tracks) {
            if (track.clips.find(c => c.id === clipId)) return track;
        }
        return null;
    }

    removeClip(clipId) {
        for (const track of this.state.tracks) {
            const idx = track.clips.findIndex(c => c.id === clipId);
            if (idx !== -1) {
                track.clips.splice(idx, 1);
                if (this.state.selectedClipId === clipId) {
                    this.state.selectedClipId = null;
                    this._renderProperties();
                    this._showRegionEditor();
                    this._updateOverlayActive();
                }
                window.timeline.render();
                window.videoPlayer.redraw();
                return;
            }
        }
    }

    onClipChanged(clip) {
        if (this.state.selectedClipId === clip.id) {
            this._renderProperties();
        }
    }

    selectSegment(segId) {
        this.state.selectedSegId = segId;
        this.state.selectedClipId = null; // deselect effect clip
        window.timeline.render();
        this._renderProperties();
        this._showRegionEditor();
        this._updateOverlayActive();
    }

    getSelectedSegment() {
        if (!this.state.selectedSegId) return null;
        return (this.state.videoSegments || []).find(s => s.id === this.state.selectedSegId) || null;
    }

    // ========== Properties Panel ==========

    _renderProperties() {
        const container = document.getElementById('properties-content');

        // Check for selected video segment first
        const seg = this.getSelectedSegment();
        if (seg) {
            this._renderSegmentProperties(container, seg);
            return;
        }

        const clip = this.getSelectedClip();

        if (!clip) {
            container.innerHTML = '<p class="placeholder-text">Click a clip on timeline to edit, or use + buttons to add effects</p>';
            return;
        }

        const track = this.getTrackForClip(clip.id);
        if (!track) return;

        let html = '';

        // Time
        html += `
            <div class="prop-group">
                <div class="prop-group-title">Time</div>
                <div class="prop-row">
                    <span class="prop-label">Start</span>
                    <input class="prop-input" type="number" step="0.1" min="0" value="${clip.startTime.toFixed(2)}" data-prop="startTime">
                </div>
                <div class="prop-row">
                    <span class="prop-label">End</span>
                    <input class="prop-input" type="number" step="0.1" min="0" value="${clip.endTime.toFixed(2)}" data-prop="endTime">
                </div>
                <div class="prop-row">
                    <span class="prop-label">Transition</span>
                    <input class="prop-input" type="number" step="0.05" min="0" max="2" value="${clip.transitionDuration.toFixed(2)}" data-prop="transitionDuration">
                </div>
            </div>
        `;

        if (track.type === 'zoom') {
            html += this._renderZoomProps(clip);
        } else if (track.type === 'highlight') {
            html += this._renderHighlightProps(clip);
        } else if (track.type === 'text') {
            html += this._renderTextProps(clip);
        }

        html += `<button class="btn btn-danger" id="btn-delete-clip">Delete Clip</button>`;
        container.innerHTML = html;
        this._bindPropertyEvents(clip);

        // Init minimap for zoom clips
        if (track.type === 'zoom') {
            this._initZoomMinimap(clip);
        }
    }

    _renderSegmentProperties(container, seg) {
        const duration = (seg.endTime - seg.startTime).toFixed(2);
        container.innerHTML = `
            <div class="prop-group">
                <div class="prop-group-title">Video Segment</div>
                <div class="prop-row">
                    <span class="prop-label">Start</span>
                    <span style="font-size:12px;color:#c5c6d9;">${seg.startTime.toFixed(2)}s</span>
                </div>
                <div class="prop-row">
                    <span class="prop-label">End</span>
                    <span style="font-size:12px;color:#c5c6d9;">${seg.endTime.toFixed(2)}s</span>
                </div>
                <div class="prop-row">
                    <span class="prop-label">Duration</span>
                    <span style="font-size:12px;color:#c5c6d9;">${duration}s</span>
                </div>
            </div>
            <div class="prop-group">
                <div class="prop-group-title">Playback Speed</div>
                <div class="prop-row">
                    <input class="prop-input" type="range" id="seg-speed-slider" min="0.05" max="3" step="0.05" value="${seg.speed || 1}" style="flex:1;">
                    <span id="seg-speed-text" style="font-size:12px;color:#c5c6d9;min-width:40px;text-align:right;">${(seg.speed || 1).toFixed(2)}x</span>
                </div>
                <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;">
                    <button class="btn btn-tiny seg-speed-preset" data-speed="0.05">0.05x</button>
                    <button class="btn btn-tiny seg-speed-preset" data-speed="0.1">0.1x</button>
                    <button class="btn btn-tiny seg-speed-preset" data-speed="0.25">0.25x</button>
                    <button class="btn btn-tiny seg-speed-preset" data-speed="0.5">0.5x</button>
                    <button class="btn btn-tiny seg-speed-preset" data-speed="1">1x</button>
                    <button class="btn btn-tiny seg-speed-preset" data-speed="1.5">1.5x</button>
                    <button class="btn btn-tiny seg-speed-preset" data-speed="2">2x</button>
                    <button class="btn btn-tiny seg-speed-preset" data-speed="3">3x</button>
                </div>
            </div>
            <button class="btn btn-danger" id="btn-delete-seg">Delete Segment</button>
        `;

        // Speed slider
        const slider = document.getElementById('seg-speed-slider');
        const text = document.getElementById('seg-speed-text');
        slider.addEventListener('input', () => {
            seg.speed = parseFloat(slider.value);
            text.textContent = seg.speed.toFixed(2) + 'x';
            window.timeline.render();
        });

        // Preset buttons
        container.querySelectorAll('.seg-speed-preset').forEach(btn => {
            btn.addEventListener('click', () => {
                seg.speed = parseFloat(btn.dataset.speed);
                slider.value = seg.speed;
                text.textContent = seg.speed.toFixed(2) + 'x';
                window.timeline.render();
            });
        });

        // Delete
        document.getElementById('btn-delete-seg').addEventListener('click', () => {
            const segs = this.state.videoSegments;
            const idx = segs.findIndex(s => s.id === seg.id);
            if (idx !== -1 && segs.length > 1) {
                segs.splice(idx, 1);
                this.state.selectedSegId = null;
                this._renderProperties();
                window.timeline.render();
                window.videoPlayer.redraw();
            }
        });
    }

    _renderZoomProps(clip) {
        // Calculate zoom level from region size (smaller region = more zoom)
        const zoomLevel = Math.round((1 / clip.regionW) * 100);
        return `
            <div class="prop-group">
                <div class="prop-group-title">Zoom Control</div>
                <p style="font-size:11px;color:#8b8ca7;margin-bottom:8px;">Drag the circle to set zoom center. Use slider to adjust zoom level.</p>
                <div class="zoom-minimap-wrapper">
                    <canvas id="zoom-minimap" class="zoom-minimap"></canvas>
                    <div class="zoom-level-badge" id="zoom-level-badge">${zoomLevel}%</div>
                </div>
                <div class="prop-row" style="margin-top:8px;">
                    <span class="prop-label">Zoom</span>
                    <input class="prop-input" type="range" id="zoom-level-slider" min="110" max="500" value="${zoomLevel}" style="flex:1;">
                    <span id="zoom-level-text" style="font-size:11px;color:#8b8ca7;min-width:35px;text-align:right;">${zoomLevel}%</span>
                </div>
                <div class="prop-row">
                    <span class="prop-label">Transition</span>
                    <input class="prop-input" type="number" step="0.05" min="0" max="2" value="${clip.transitionDuration.toFixed(2)}" data-prop="transitionDuration">
                </div>
            </div>
        `;
    }

    /**
     * Initialize the zoom minimap canvas with video frame + draggable point
     */
    _initZoomMinimap(clip) {
        const canvas = document.getElementById('zoom-minimap');
        if (!canvas) return;

        const video = window.videoPlayer.video;
        const aspect = video.videoWidth / video.videoHeight;
        const mapW = 248;
        const mapH = Math.round(mapW / aspect);
        canvas.width = mapW;
        canvas.height = mapH;
        canvas.style.height = mapH + 'px';

        const ctx = canvas.getContext('2d');
        this._drawMinimap(ctx, canvas, clip);

        // Drag state
        let dragging = false;

        const updateFromMouse = (e) => {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const mx = (e.clientX - rect.left) * scaleX;
            const my = (e.clientY - rect.top) * scaleY;

            // Store center position directly (0-1), dot can go anywhere
            clip._centerX = Math.max(0, Math.min(1, mx / canvas.width));
            clip._centerY = Math.max(0, Math.min(1, my / canvas.height));

            // Compute region from center, clamped so region stays in bounds
            clip.regionX = Math.max(0, Math.min(1 - clip.regionW, clip._centerX - clip.regionW / 2));
            clip.regionY = Math.max(0, Math.min(1 - clip.regionH, clip._centerY - clip.regionH / 2));

            this._drawMinimap(ctx, canvas, clip);
            window.videoPlayer.redraw();
        };

        canvas.addEventListener('mousedown', (e) => {
            dragging = true;
            updateFromMouse(e);
        });
        canvas.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            updateFromMouse(e);
        });
        document.addEventListener('mouseup', () => {
            if (dragging) {
                dragging = false;
                this._renderProperties();
            }
        });

        // Zoom level slider
        const slider = document.getElementById('zoom-level-slider');
        if (slider) {
            slider.addEventListener('input', () => {
                const zoom = parseInt(slider.value) / 100;
                const newSize = 1 / zoom;

                // Keep center, adjust region size
                const cx = clip._centerX !== undefined ? clip._centerX : (clip.regionX + clip.regionW / 2);
                const cy = clip._centerY !== undefined ? clip._centerY : (clip.regionY + clip.regionH / 2);
                clip.regionW = Math.max(0.05, Math.min(1, newSize));
                clip.regionH = Math.max(0.05, Math.min(1, newSize));
                clip.regionX = Math.max(0, Math.min(1 - clip.regionW, cx - clip.regionW / 2));
                clip.regionY = Math.max(0, Math.min(1 - clip.regionH, cy - clip.regionH / 2));

                document.getElementById('zoom-level-text').textContent = slider.value + '%';
                document.getElementById('zoom-level-badge').textContent = slider.value + '%';
                this._drawMinimap(ctx, canvas, clip);
                window.videoPlayer.redraw();
            });
        }
    }

    /**
     * Draw the minimap: video frame + single draggable circle for zoom center
     */
    _drawMinimap(ctx, canvas, clip) {
        const w = canvas.width;
        const h = canvas.height;
        const video = window.videoPlayer.video;

        // Draw video frame
        ctx.drawImage(video, 0, 0, w, h);

        // Light vignette overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.fillRect(0, 0, w, h);

        // Zoom center point - use stored center or compute from region
        const cx = clip._centerX !== undefined ? clip._centerX : (clip.regionX + clip.regionW / 2);
        const cy = clip._centerY !== undefined ? clip._centerY : (clip.regionY + clip.regionH / 2);
        const centerX = cx * w;
        const centerY = cy * h;

        // Crosshair lines from edge to edge
        ctx.strokeStyle = 'rgba(124, 92, 231, 0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(centerX, 0);
        ctx.lineTo(centerX, h);
        ctx.moveTo(0, centerY);
        ctx.lineTo(w, centerY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Outer glow ring
        ctx.beginPath();
        ctx.arc(centerX, centerY, 18, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(124, 92, 231, 0.3)';
        ctx.lineWidth = 8;
        ctx.stroke();

        // Main circle
        ctx.beginPath();
        ctx.arc(centerX, centerY, 14, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(124, 92, 231, 0.85)';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Inner crosshair inside circle
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(centerX - 6, centerY);
        ctx.lineTo(centerX + 6, centerY);
        ctx.moveTo(centerX, centerY - 6);
        ctx.lineTo(centerX, centerY + 6);
        ctx.stroke();
    }

    _renderHighlightProps(clip) {
        return `
            <div class="prop-group">
                <div class="prop-group-title">Highlight Region</div>
                <p style="font-size:11px;color:#8b8ca7;margin-bottom:8px;">Drag the region on the video to adjust highlight area. Use corner handles to resize.</p>
                <div class="prop-row">
                    <span class="prop-label">X</span>
                    <input class="prop-input" type="number" step="0.01" min="0" max="1" value="${clip.regionX.toFixed(3)}" data-prop="regionX">
                </div>
                <div class="prop-row">
                    <span class="prop-label">Y</span>
                    <input class="prop-input" type="number" step="0.01" min="0" max="1" value="${clip.regionY.toFixed(3)}" data-prop="regionY">
                </div>
                <div class="prop-row">
                    <span class="prop-label">Width</span>
                    <input class="prop-input" type="number" step="0.01" min="0.05" max="1" value="${clip.regionW.toFixed(3)}" data-prop="regionW">
                </div>
                <div class="prop-row">
                    <span class="prop-label">Height</span>
                    <input class="prop-input" type="number" step="0.01" min="0.05" max="1" value="${clip.regionH.toFixed(3)}" data-prop="regionH">
                </div>
            </div>
            <div class="prop-group">
                <div class="prop-group-title">Style</div>
                <div class="prop-row">
                    <span class="prop-label">Color</span>
                    <input class="prop-input" type="color" value="${clip.color}" data-prop="color">
                </div>
                <div class="prop-row">
                    <span class="prop-label">Dim</span>
                    <input class="prop-input" type="range" min="0" max="1" step="0.05" value="${clip.opacity}" data-prop="opacity">
                </div>
                <div class="prop-row">
                    <span class="prop-label">Shape</span>
                    <select class="prop-select" data-prop="shape">
                        <option value="rectangle" ${clip.shape === 'rectangle' ? 'selected' : ''}>Rectangle</option>
                        <option value="ellipse" ${clip.shape === 'ellipse' ? 'selected' : ''}>Ellipse</option>
                    </select>
                </div>
                <div class="prop-row">
                    <span class="prop-label">Border</span>
                    <input class="prop-input" type="number" min="0" max="10" value="${clip.borderWidth}" data-prop="borderWidth">
                </div>
                <div class="prop-row">
                    <span class="prop-label">Glow</span>
                    <input type="checkbox" ${clip.glowEnabled ? 'checked' : ''} data-prop="glowEnabled">
                </div>
            </div>
        `;
    }

    _renderTextProps(clip) {
        return `
            <div class="prop-group">
                <div class="prop-group-title">Text Content</div>
                <textarea class="prop-textarea" data-prop="text" placeholder="Enter text...">${clip.text || ''}</textarea>
            </div>
            <div class="prop-group">
                <div class="prop-group-title">Position & Style</div>
                <div class="prop-row">
                    <span class="prop-label">X</span>
                    <input class="prop-input" type="number" step="0.01" min="0" max="1" value="${clip.posX.toFixed(3)}" data-prop="posX">
                </div>
                <div class="prop-row">
                    <span class="prop-label">Y</span>
                    <input class="prop-input" type="number" step="0.01" min="0" max="1" value="${clip.posY.toFixed(3)}" data-prop="posY">
                </div>
                <div class="prop-row">
                    <span class="prop-label">Size</span>
                    <input class="prop-input" type="number" min="8" max="200" value="${clip.fontSize}" data-prop="fontSize">
                </div>
                <div class="prop-row">
                    <span class="prop-label">Font</span>
                    <select class="prop-select" data-prop="fontFamily">
                        <option value="Arial" ${clip.fontFamily === 'Arial' ? 'selected' : ''}>Arial</option>
                        <option value="Helvetica" ${clip.fontFamily === 'Helvetica' ? 'selected' : ''}>Helvetica</option>
                        <option value="Georgia" ${clip.fontFamily === 'Georgia' ? 'selected' : ''}>Georgia</option>
                        <option value="Courier New" ${clip.fontFamily === 'Courier New' ? 'selected' : ''}>Courier New</option>
                        <option value="Verdana" ${clip.fontFamily === 'Verdana' ? 'selected' : ''}>Verdana</option>
                        <option value="Impact" ${clip.fontFamily === 'Impact' ? 'selected' : ''}>Impact</option>
                    </select>
                </div>
                <div class="prop-row">
                    <span class="prop-label">Color</span>
                    <input class="prop-input" type="color" value="${clip.color}" data-prop="color">
                </div>
                <div class="prop-row">
                    <span class="prop-label">Bold</span>
                    <input type="checkbox" ${clip.bold ? 'checked' : ''} data-prop="bold">
                </div>
                <div class="prop-row">
                    <span class="prop-label">Italic</span>
                    <input type="checkbox" ${clip.italic ? 'checked' : ''} data-prop="italic">
                </div>
            </div>
            <div class="prop-group">
                <div class="prop-group-title">Background</div>
                <div class="prop-row">
                    <span class="prop-label">Enabled</span>
                    <input type="checkbox" ${clip.bgEnabled ? 'checked' : ''} data-prop="bgEnabled">
                </div>
                <div class="prop-row">
                    <span class="prop-label">BG Color</span>
                    <input class="prop-input" type="color" value="${this._rgbaToHex(clip.bgColor)}" data-prop="bgColor">
                </div>
            </div>
        `;
    }

    _rgbaToHex(rgba) {
        if (!rgba) return '#000000';
        if (rgba.startsWith('#')) return rgba;
        return '#000000';
    }

    _bindPropertyEvents(clip) {
        const container = document.getElementById('properties-content');

        container.querySelectorAll('.prop-input, .prop-select, .prop-textarea').forEach(input => {
            const prop = input.dataset.prop;
            if (!prop) return;

            const handler = () => {
                const type = input.type;
                if (type === 'number' || type === 'range') {
                    clip[prop] = parseFloat(input.value);
                } else if (type === 'color') {
                    clip[prop] = input.value;
                } else {
                    clip[prop] = input.value;
                }
                window.videoPlayer.redraw();
                window.timeline.render();
                this._showRegionEditor(); // refresh overlay
            };

            input.addEventListener('input', handler);
            input.addEventListener('change', handler);
        });

        container.querySelectorAll('input[type="checkbox"]').forEach(input => {
            const prop = input.dataset.prop;
            if (!prop) return;
            input.addEventListener('change', () => {
                clip[prop] = input.checked;
                window.videoPlayer.redraw();
            });
        });

        const btnDelete = document.getElementById('btn-delete-clip');
        if (btnDelete) {
            btnDelete.addEventListener('click', () => this.removeClip(clip.id));
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
