/**
 * Timeline - Kapwing-style track management, clip drag/resize, ruler, playhead
 */

class Timeline {
    constructor() {
        this.container = document.getElementById('timeline-container');
        this.rulerEl = document.getElementById('timeline-ruler');
        this.playheadEl = document.getElementById('timeline-playhead');
        this.tracksEl = document.getElementById('timeline-tracks');

        this.pixelsPerSecond = 80;
        this.trackLabelWidth = 28; // Minimal - just track number
        this.duration = 0;

        // Video thumbnail cache
        this.thumbnails = [];
        this.thumbnailHeight = 54;
        this.thumbnailsGenerated = false;
        this.thumbnailGenerating = false;

        // Drag state
        this.dragState = null;

        this._initEvents();
    }

    _initEvents() {
        // Ruler click to seek
        this.rulerEl.addEventListener('mousedown', (e) => {
            this._seekFromRuler(e);
            const onMove = (e2) => this._seekFromRuler(e2);
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        // Zoom slider
        const zoomSlider = document.getElementById('timeline-zoom-slider');
        if (zoomSlider) {
            zoomSlider.addEventListener('input', () => {
                this.pixelsPerSecond = parseInt(zoomSlider.value);
                this.render();
            });
        }

        // Zoom buttons
        document.getElementById('btn-zoom-in-timeline').addEventListener('click', () => {
            this.pixelsPerSecond = Math.min(400, this.pixelsPerSecond * 1.3);
            if (zoomSlider) zoomSlider.value = this.pixelsPerSecond;
            this.render();
        });
        document.getElementById('btn-zoom-out-timeline').addEventListener('click', () => {
            this.pixelsPerSecond = Math.max(20, this.pixelsPerSecond / 1.3);
            if (zoomSlider) zoomSlider.value = this.pixelsPerSecond;
            this.render();
        });
        document.getElementById('btn-fit-timeline').addEventListener('click', () => {
            if (this.duration > 0) {
                const availableWidth = this.container.clientWidth - this.trackLabelWidth - 20;
                this.pixelsPerSecond = Math.max(20, Math.min(400, availableWidth / this.duration));
                if (zoomSlider) zoomSlider.value = this.pixelsPerSecond;
                this.render();
            }
        });

        // Play button in timeline toolbar
        const btnPlayTl = document.getElementById('btn-play-tl');
        if (btnPlayTl) {
            btnPlayTl.addEventListener('click', () => {
                if (window.videoPlayer) window.videoPlayer.togglePlay();
            });
        }

        // Split button
        const btnSplit = document.getElementById('btn-split');
        if (btnSplit) {
            btnSplit.addEventListener('click', () => this._splitClipAtPlayhead());
        }

        // Horizontal scroll with mouse wheel
        this.container.addEventListener('wheel', (e) => {
            if (e.shiftKey || Math.abs(e.deltaX) > 0) {
                // Shift+wheel or horizontal wheel = scroll timeline
                e.preventDefault();
                this.container.scrollLeft += (e.deltaX || e.deltaY);
            } else {
                // Normal wheel = scroll timeline horizontally too (more intuitive)
                e.preventDefault();
                this.container.scrollLeft += e.deltaY;
            }
        }, { passive: false });

        // Middle-click or empty-area drag to pan timeline
        this.panState = null;
        this.container.addEventListener('mousedown', (e) => {
            // Middle click anywhere, or left-click on empty track area
            const isMiddle = e.button === 1;
            const isEmpty = e.target === this.container ||
                           e.target === this.tracksEl ||
                           e.target.classList.contains('track-clips');
            if (isMiddle || (isEmpty && e.button === 0)) {
                // Don't pan if clicking on a clip or segment
                if (e.target.closest('.timeline-clip') || e.target.closest('.video-segment')) return;
                this.panState = {
                    startX: e.clientX,
                    startScrollLeft: this.container.scrollLeft
                };
                this.container.style.cursor = 'grabbing';
                e.preventDefault();
            }
        });

        // Global mouse events for drag
        document.addEventListener('mousemove', (e) => {
            // Pan timeline
            if (this.panState) {
                const dx = e.clientX - this.panState.startX;
                this.container.scrollLeft = this.panState.startScrollLeft - dx;
                return;
            }
            this._onMouseMove(e);
        });
        document.addEventListener('mouseup', (e) => {
            if (this.panState) {
                this.panState = null;
                this.container.style.cursor = '';
                return;
            }
            this._onMouseUp(e);
        });
    }

    _seekFromRuler(e) {
        // e.clientX is viewport position of click
        // container.getBoundingClientRect().left is where the container starts in viewport
        // scrollLeft is how far the container has scrolled
        // trackLabelWidth is the fixed label area on the left
        const containerRect = this.container.getBoundingClientRect();
        const x = e.clientX - containerRect.left + this.container.scrollLeft - this.trackLabelWidth;
        const time = Math.max(0, Math.min(this.duration, x / this.pixelsPerSecond));
        if (window.videoPlayer) {
            window.videoPlayer.seekTo(time);
        }
    }

    _splitClipAtPlayhead() {
        if (!window.app || !window.videoPlayer) return;
        const currentTime = window.videoPlayer.video.currentTime;

        // Try to split a video segment first
        const segments = window.app.state.videoSegments || [];
        for (const seg of segments) {
            if (currentTime > seg.startTime + 0.1 && currentTime < seg.endTime - 0.1) {
                const oldMaxEnd = seg._maxEnd !== undefined ? seg._maxEnd : seg.endTime;
                const newSeg = {
                    id: 'vseg_' + Date.now(),
                    startTime: currentTime,
                    endTime: seg.endTime,
                    speed: seg.speed || 1,
                    _minStart: currentTime,
                    _maxEnd: oldMaxEnd
                };
                // Update original segment bounds
                seg._maxEnd = currentTime;
                seg.endTime = currentTime;
                segments.push(newSeg);
                // Sort segments by startTime
                segments.sort((a, b) => a.startTime - b.startTime);
                this.render();
                return;
            }
        }

        // Otherwise split selected effect clip
        const selectedClip = window.app.getSelectedClip();
        if (!selectedClip) return;
        if (currentTime <= selectedClip.startTime || currentTime >= selectedClip.endTime) return;

        const track = window.app.getTrackForClip(selectedClip.id);
        if (!track) return;

        const newClip = { ...selectedClip };
        newClip.id = 'clip_' + window.app.state.nextClipId++;
        newClip.startTime = currentTime;
        selectedClip.endTime = currentTime;

        track.clips.push(newClip);
        this.render();
        window.videoPlayer.redraw();
    }

    setDuration(duration) {
        this.duration = duration;
        this.thumbnailsGenerated = false;
        this._generateThumbnails();
        this.render();
    }

    _generateThumbnails() {
        if (this.thumbnailGenerating) return;
        const video = window.videoPlayer ? window.videoPlayer.video : null;
        if (!video || !video.duration) return;

        this.thumbnailGenerating = true;
        this.thumbnails = [];

        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const thumbH = this.thumbnailHeight;
        const thumbW = Math.round((vw / vh) * thumbH);
        const interval = Math.max(0.5, Math.min(2, this.duration / 50));
        const times = [];
        for (let t = 0; t < this.duration; t += interval) {
            times.push(t);
        }

        const tempVideo = document.createElement('video');
        tempVideo.src = video.src;
        tempVideo.muted = true;
        tempVideo.preload = 'auto';

        let idx = 0;

        const captureNext = () => {
            if (idx >= times.length) {
                this.thumbnailsGenerated = true;
                this.thumbnailGenerating = false;
                this.render();
                return;
            }
            tempVideo.currentTime = times[idx];
        };

        tempVideo.onseeked = () => {
            const c = document.createElement('canvas');
            c.width = thumbW;
            c.height = thumbH;
            const cx = c.getContext('2d');
            cx.drawImage(tempVideo, 0, 0, thumbW, thumbH);
            this.thumbnails.push({ time: times[idx], canvas: c, width: thumbW });
            idx++;
            captureNext();
        };

        tempVideo.onloadeddata = () => captureNext();
    }

    /** Render entire timeline */
    render() {
        const tracks = window.app ? window.app.state.tracks : [];
        this._renderRuler();
        this._renderTracks(tracks);
        this.updatePlayhead(window.videoPlayer ? window.videoPlayer.video.currentTime : 0);
        this._updateTimeDisplay();
    }

    _updateTimeDisplay() {
        const el = document.getElementById('time-display-tl');
        if (!el || !window.videoPlayer) return;
        const v = window.videoPlayer.video;
        const fmt = (t) => {
            const m = Math.floor(t / 60);
            const s = Math.floor(t % 60);
            const ms = Math.floor((t % 1) * 100);
            return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
        };
        el.textContent = `${fmt(v.currentTime)} / ${fmt(v.duration || 0)}`;
    }

    _renderRuler() {
        const totalWidth = this.duration * this.pixelsPerSecond + this.trackLabelWidth;
        this.rulerEl.style.width = totalWidth + 'px';
        this.rulerEl.innerHTML = '';

        // Determine major tick interval
        let majorInterval = 5;
        if (this.pixelsPerSecond >= 150) majorInterval = 1;
        else if (this.pixelsPerSecond >= 60) majorInterval = 2;
        else if (this.pixelsPerSecond >= 30) majorInterval = 5;
        else majorInterval = 10;

        const minorInterval = majorInterval / 5;

        for (let t = 0; t <= this.duration; t += minorInterval) {
            const roundedT = Math.round(t * 100) / 100;
            const isMajor = Math.abs(roundedT % majorInterval) < 0.01 || Math.abs(roundedT % majorInterval - majorInterval) < 0.01;
            const left = this.trackLabelWidth + roundedT * this.pixelsPerSecond;

            if (isMajor) {
                const tick = document.createElement('div');
                tick.className = 'ruler-tick major';
                tick.style.left = left + 'px';
                // Format: :05, :10, :15 or 1:00, 1:05
                const m = Math.floor(roundedT / 60);
                const s = Math.floor(roundedT % 60);
                if (m > 0) {
                    tick.textContent = `${m}:${String(s).padStart(2, '0')}`;
                } else {
                    tick.textContent = `:${String(s).padStart(2, '0')}`;
                }
                this.rulerEl.appendChild(tick);
            } else {
                // Minor dots
                const dot = document.createElement('div');
                dot.className = 'ruler-dot';
                dot.style.left = left + 'px';
                this.rulerEl.appendChild(dot);
            }
        }
    }

    _renderTracks(tracks) {
        this.tracksEl.innerHTML = '';
        const totalWidth = this.duration * this.pixelsPerSecond + this.trackLabelWidth;

        // Track 1: Video Preview (always first, at top like Kapwing)
        this._renderVideoPreviewTrack(totalWidth, 1);

        // Track 2, 3, 4...: Effect tracks
        tracks.forEach((track, index) => {
            const trackNum = index + 2;
            const trackEl = document.createElement('div');
            trackEl.className = 'timeline-track';
            trackEl.dataset.trackId = track.id;

            // Track number label (minimal)
            const label = document.createElement('div');
            label.className = 'track-label';
            label.textContent = trackNum;

            // Remove button (hidden, shows on hover)
            const removeBtn = document.createElement('button');
            removeBtn.className = 'btn-remove-track';
            removeBtn.textContent = '\u00d7';
            removeBtn.title = 'Remove track';
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.app) window.app.removeTrack(track.id);
            });
            label.appendChild(removeBtn);
            trackEl.appendChild(label);

            // Clips area
            const clipsArea = document.createElement('div');
            clipsArea.className = 'track-clips';
            clipsArea.style.width = (totalWidth - this.trackLabelWidth) + 'px';

            // Double-click to add clip
            clipsArea.addEventListener('dblclick', (e) => {
                const rect = clipsArea.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const time = x / this.pixelsPerSecond;
                const clipDuration = Math.min(3, this.duration - time);
                if (clipDuration > 0.1 && window.app) {
                    window.app.addClip(track.id, time, time + clipDuration);
                }
            });

            // Render clips
            track.clips.forEach((clip) => {
                const clipEl = this._createClipElement(clip, track.type);
                clipsArea.appendChild(clipEl);
            });

            trackEl.appendChild(clipsArea);
            this.tracksEl.appendChild(trackEl);
        });

        this.tracksEl.style.minWidth = totalWidth + 'px';
    }

    _renderVideoPreviewTrack(totalWidth, trackNum) {
        if (!this.duration) return;
        if (!window.app.state.videoSegments || window.app.state.videoSegments.length === 0) return;

        const trackEl = document.createElement('div');
        trackEl.className = 'timeline-track video-preview-track';

        const label = document.createElement('div');
        label.className = 'track-label';
        label.textContent = trackNum;
        trackEl.appendChild(label);

        // Clips area (contains video segments)
        const clipsArea = document.createElement('div');
        clipsArea.className = 'track-clips';
        clipsArea.style.width = (totalWidth - this.trackLabelWidth) + 'px';
        clipsArea.style.background = '#0d0e1a';

        // Click empty area to seek
        clipsArea.addEventListener('mousedown', (e) => {
            if (e.target === clipsArea) {
                const rect = clipsArea.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const time = Math.max(0, Math.min(this.duration, x / this.pixelsPerSecond));
                if (window.videoPlayer) window.videoPlayer.seekTo(time);
            }
        });

        // Render each video segment as a resizable clip with thumbnails
        window.app.state.videoSegments.forEach((seg, idx) => {
            if (!seg.speed) seg.speed = 1;

            const segEl = document.createElement('div');
            segEl.className = 'video-segment';
            if (window.app.state.selectedSegId === seg.id) {
                segEl.classList.add('seg-selected');
            }
            segEl.dataset.segId = seg.id;
            const left = seg.startTime * this.pixelsPerSecond;
            const width = (seg.endTime - seg.startTime) * this.pixelsPerSecond;
            segEl.style.left = left + 'px';
            segEl.style.width = Math.max(20, width) + 'px';

            // Thumbnails inside segment
            if (this.thumbnailsGenerated && this.thumbnails.length > 0) {
                const interval = this.thumbnails.length > 1 ? this.thumbnails[1].time - this.thumbnails[0].time : 1;
                const pxPerThumb = interval * this.pixelsPerSecond;

                this.thumbnails.forEach((thumb) => {
                    if (thumb.time >= seg.startTime && thumb.time < seg.endTime) {
                        const img = document.createElement('canvas');
                        img.className = 'video-thumb';
                        img.width = thumb.canvas.width;
                        img.height = thumb.canvas.height;
                        const cx = img.getContext('2d');
                        cx.drawImage(thumb.canvas, 0, 0);
                        img.style.left = ((thumb.time - seg.startTime) * this.pixelsPerSecond) + 'px';
                        img.style.width = Math.ceil(pxPerThumb + 1) + 'px';
                        img.style.height = this.thumbnailHeight + 'px';
                        segEl.appendChild(img);
                    }
                });
            }

            // Speed badge (if not 1x)
            if (seg.speed !== 1) {
                const badge = document.createElement('div');
                badge.className = 'seg-speed-badge';
                badge.textContent = seg.speed + 'x';
                segEl.appendChild(badge);
            }

            // Trim handles
            const handleL = document.createElement('div');
            handleL.className = 'clip-handle clip-handle-left video-handle';
            handleL.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                this._startVideoDrag(e, seg, 'resize-left');
            });

            const handleR = document.createElement('div');
            handleR.className = 'clip-handle clip-handle-right video-handle';
            handleR.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                this._startVideoDrag(e, seg, 'resize-right');
            });

            segEl.appendChild(handleL);
            segEl.appendChild(handleR);

            // Click to select segment, drag to move
            segEl.addEventListener('mousedown', (e) => {
                if (e.target.classList.contains('clip-handle')) return;
                e.stopPropagation();
                window.app.selectSegment(seg.id);
                this._startVideoDrag(e, seg, 'move');
            });

            clipsArea.appendChild(segEl);
        });

        trackEl.appendChild(clipsArea);
        this.tracksEl.appendChild(trackEl);
    }

    _startVideoDrag(e, seg, type) {
        const currentDuration = seg.endTime - seg.startTime;
        // Store max bounds: segment can never grow beyond its current edges
        // This prevents "restoring" trimmed content
        if (seg._maxEnd === undefined) seg._maxEnd = seg.endTime;
        if (seg._minStart === undefined) seg._minStart = seg.startTime;

        this.dragState = {
            videoSegId: seg.id,
            type,
            startX: e.clientX + this.container.scrollLeft,
            origStart: seg.startTime,
            origEnd: seg.endTime,
            lockedDuration: currentDuration
        };
        e.preventDefault();
    }

    _createClipElement(clip, trackType) {
        const el = document.createElement('div');
        el.className = `timeline-clip ${trackType}-clip`;
        if (window.app && window.app.state.selectedClipId === clip.id) {
            el.classList.add('selected');
        }
        el.dataset.clipId = clip.id;

        const left = clip.startTime * this.pixelsPerSecond;
        const width = (clip.endTime - clip.startTime) * this.pixelsPerSecond;
        el.style.left = left + 'px';
        el.style.width = Math.max(24, width) + 'px';

        // Label
        const label = document.createElement('span');
        label.className = 'clip-label';
        if (trackType === 'text' && clip.text) {
            label.textContent = clip.text.substring(0, 30);
        } else if (trackType === 'zoom') {
            label.textContent = 'Zoom';
        } else if (trackType === 'highlight') {
            label.textContent = 'Highlight';
        }
        el.appendChild(label);

        // Resize handles
        const handleL = document.createElement('div');
        handleL.className = 'clip-handle clip-handle-left';
        handleL.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this._startDrag(e, clip, 'resize-left');
        });

        const handleR = document.createElement('div');
        handleR.className = 'clip-handle clip-handle-right';
        handleR.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this._startDrag(e, clip, 'resize-right');
        });

        el.appendChild(handleL);
        el.appendChild(handleR);

        // Click to select, mousedown to start drag
        el.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('clip-handle')) return;
            e.stopPropagation(); // prevent timeline pan
            if (window.app) window.app.selectClip(clip.id);
            this._startDrag(e, clip, 'move');
        });

        return el;
    }

    _startDrag(e, clip, type) {
        this.dragState = {
            clipId: clip.id,
            type,
            startX: e.clientX + this.container.scrollLeft,
            origStart: clip.startTime,
            origEnd: clip.endTime
        };
        e.preventDefault();
    }

    _onMouseMove(e) {
        if (!this.dragState) return;
        // Include scroll offset so drag stays accurate when timeline is scrolled
        const currentX = e.clientX + this.container.scrollLeft;
        const dx = currentX - this.dragState.startX;
        const dt = dx / this.pixelsPerSecond;
        const minDuration = 0.1;

        // Video segment drag
        if (this.dragState.videoSegId) {
            const seg = window.app.state.videoSegments.find(s => s.id === this.dragState.videoSegId);
            if (!seg) return;

            if (this.dragState.type === 'move') {
                // Use locked duration so move can never expand a trimmed segment
                const segLen = this.dragState.lockedDuration;
                let newStart = this.dragState.origStart + dt;
                // Clamp to timeline bounds
                newStart = Math.max(0, Math.min(this.duration - segLen, newStart));
                seg.startTime = newStart;
                seg.endTime = newStart + segLen;
            } else if (this.dragState.type === 'resize-left') {
                // During this drag: can go back to origStart but not beyond _minStart
                const minStart = seg._minStart !== undefined ? seg._minStart : 0;
                let newStart = this.dragState.origStart + dt;
                // Clamp: can't go left past minStart, can't go right past endTime
                newStart = Math.max(minStart, Math.min(newStart, seg.endTime - minDuration));
                seg.startTime = newStart;
            } else if (this.dragState.type === 'resize-right') {
                // During this drag: can go back to origEnd but not beyond _maxEnd
                const maxEnd = seg._maxEnd !== undefined ? seg._maxEnd : this.duration;
                let newEnd = this.dragState.origEnd + dt;
                // Clamp: can't go right past maxEnd, can't go left past startTime
                newEnd = Math.min(maxEnd, Math.max(newEnd, seg.startTime + minDuration));
                seg.endTime = newEnd;
            }

            const segEl = this.tracksEl.querySelector(`[data-seg-id="${seg.id}"]`);
            if (segEl) {
                segEl.style.left = (seg.startTime * this.pixelsPerSecond) + 'px';
                segEl.style.width = Math.max(20, (seg.endTime - seg.startTime) * this.pixelsPerSecond) + 'px';
            }

            // Redraw video (show black if outside segment)
            if (window.videoPlayer) window.videoPlayer.redraw();
            return;
        }

        // Effect clip drag
        const clip = window.app ? window.app.getClipById(this.dragState.clipId) : null;
        if (!clip) return;

        if (this.dragState.type === 'move') {
            let newStart = this.dragState.origStart + dt;
            let newEnd = this.dragState.origEnd + dt;
            const clipLen = newEnd - newStart;
            if (newStart < 0) { newStart = 0; newEnd = clipLen; }
            if (newEnd > this.duration) { newEnd = this.duration; newStart = this.duration - clipLen; }
            clip.startTime = Math.max(0, newStart);
            clip.endTime = Math.min(this.duration, newEnd);
        } else if (this.dragState.type === 'resize-left') {
            clip.startTime = Math.max(0, Math.min(this.dragState.origStart + dt, clip.endTime - minDuration));
        } else if (this.dragState.type === 'resize-right') {
            clip.endTime = Math.min(this.duration, Math.max(this.dragState.origEnd + dt, clip.startTime + minDuration));
        }

        const clipEl = this.tracksEl.querySelector(`[data-clip-id="${clip.id}"]`);
        if (clipEl) {
            clipEl.style.left = (clip.startTime * this.pixelsPerSecond) + 'px';
            clipEl.style.width = Math.max(24, (clip.endTime - clip.startTime) * this.pixelsPerSecond) + 'px';
        }

        if (window.app) window.app.onClipChanged(clip);
        if (window.videoPlayer) window.videoPlayer.redraw();
    }

    _onMouseUp() {
        if (this.dragState) {
            // Commit trim bounds after resize ends
            if (this.dragState.videoSegId) {
                const seg = window.app.state.videoSegments.find(s => s.id === this.dragState.videoSegId);
                if (seg) {
                    if (this.dragState.type === 'resize-left') {
                        seg._minStart = seg.startTime;
                    } else if (this.dragState.type === 'resize-right') {
                        seg._maxEnd = seg.endTime;
                    }
                }
            }
            this.dragState = null;
            const scrollLeft = this.container.scrollLeft;
            const scrollTop = this.container.scrollTop;
            this.render();
            this.container.scrollLeft = scrollLeft;
            this.container.scrollTop = scrollTop;
        }
    }

    updatePlayhead(currentTime) {
        const left = this.trackLabelWidth + currentTime * this.pixelsPerSecond;
        this.playheadEl.style.left = left + 'px';
        this._updateTimeDisplay();
    }
}

window.Timeline = Timeline;
