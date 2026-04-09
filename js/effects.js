/**
 * Effects Engine - Zoom, Highlight, Text overlay effects
 */

class EffectsEngine {
    constructor() {
        this.transitionDuration = 0.4;
    }

    /**
     * Smooth easing - ease out quint for cinematic feel
     */
    easeOutQuint(t) {
        return 1 - Math.pow(1 - t, 5);
    }

    easeInOutQuart(t) {
        return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
    }

    /**
     * Get transition progress (0-1) with smooth easing
     * speed parameter compensates for video playback speed so transitions stay constant
     */
    getTransitionProgress(currentTime, clip, speed) {
        // Adjust fade duration: if video plays at 0.1x, fade takes 10x longer in video time
        // Compensate by scaling fade duration by speed so it always LOOKS the same wall-clock duration
        const baseFade = clip.transitionDuration || this.transitionDuration;
        const fadeDuration = baseFade * (speed || 1);
        const clipStart = clip.startTime;
        const clipEnd = clip.endTime;
        const clipDuration = clipEnd - clipStart;

        if (currentTime < clipStart || currentTime > clipEnd) return 0;

        // Ease in
        const fadeInEnd = clipStart + Math.min(fadeDuration, clipDuration / 2);
        if (currentTime < fadeInEnd) {
            const t = (currentTime - clipStart) / (fadeInEnd - clipStart);
            return this.easeOutQuint(t);
        }

        // Ease out
        const fadeOutStart = clipEnd - Math.min(fadeDuration, clipDuration / 2);
        if (currentTime > fadeOutStart) {
            const t = (clipEnd - currentTime) / (clipEnd - fadeOutStart);
            return this.easeOutQuint(t);
        }

        return 1;
    }

    /**
     * Apply zoom effect - smooth cinematic zoom with proper scaling
     */
    applyZoom(ctx, video, canvas, clip, currentTime, speed) {
        const progress = this.getTransitionProgress(currentTime, clip, speed);
        if (progress <= 0) return false;

        const { regionX, regionY, regionW, regionH } = clip;
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const cw = canvas.width;
        const ch = canvas.height;

        // Calculate zoom: interpolate from full frame (1.0) to target region
        // At progress=0: show full frame. At progress=1: show only the region
        const currentW = 1 - progress * (1 - regionW);
        const currentH = 1 - progress * (1 - regionH);
        const currentX = progress * regionX;
        const currentY = progress * regionY;

        // Source rectangle in video pixels
        const sx = currentX * vw;
        const sy = currentY * vh;
        const sw = currentW * vw;
        const sh = currentH * vh;

        // Enable image smoothing for quality
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Draw zoomed frame
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch);

        // Subtle vignette overlay during zoom for cinematic feel
        if (progress > 0.1) {
            const vignetteStrength = progress * 0.15;
            const gradient = ctx.createRadialGradient(
                cw / 2, ch / 2, cw * 0.3,
                cw / 2, ch / 2, cw * 0.8
            );
            gradient.addColorStop(0, 'rgba(0,0,0,0)');
            gradient.addColorStop(1, `rgba(0,0,0,${vignetteStrength})`);
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, cw, ch);
        }

        return true;
    }

    /**
     * Apply highlight effect - dims everything except the highlighted region
     */
    applyHighlight(ctx, canvas, clip, currentTime) {
        const progress = this.getTransitionProgress(currentTime, clip);
        if (progress <= 0) return;

        const { regionX, regionY, regionW, regionH, color, opacity, shape, borderWidth, glowEnabled } = clip;
        const cw = canvas.width;
        const ch = canvas.height;
        const dimOpacity = (opacity || 0.6) * progress;

        // Dim overlay
        ctx.save();
        ctx.fillStyle = `rgba(0, 0, 0, ${dimOpacity})`;
        ctx.beginPath();
        ctx.rect(0, 0, cw, ch);

        // Cut out the highlight region
        const rx = regionX * cw;
        const ry = regionY * ch;
        const rw = regionW * cw;
        const rh = regionH * ch;

        if (shape === 'ellipse') {
            // Ellipse cutout
            ctx.moveTo(rx + rw / 2 + rw / 2, ry + rh / 2);
            ctx.ellipse(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2, true);
        } else {
            // Rectangle cutout
            const r = 4; // border radius
            ctx.moveTo(rx + r, ry);
            ctx.lineTo(rx + rw - r, ry);
            ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + r);
            ctx.lineTo(rx + rw, ry + rh - r);
            ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - r, ry + rh);
            ctx.lineTo(rx + r, ry + rh);
            ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - r);
            ctx.lineTo(rx, ry + r);
            ctx.quadraticCurveTo(rx, ry, rx + r, ry);
        }
        ctx.closePath();
        ctx.fill('evenodd');
        ctx.restore();

        // Draw border around highlight region
        const bw = borderWidth || 2;
        const borderColor = color || '#fdcb6e';
        ctx.save();
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = bw * progress;

        if (shape === 'ellipse') {
            ctx.beginPath();
            ctx.ellipse(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            ctx.strokeRect(rx, ry, rw, rh);
        }
        ctx.restore();

        // Glow effect
        if (glowEnabled) {
            ctx.save();
            ctx.shadowColor = borderColor;
            ctx.shadowBlur = 15 * progress;
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 1;
            if (shape === 'ellipse') {
                ctx.beginPath();
                ctx.ellipse(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2);
                ctx.stroke();
            } else {
                ctx.strokeRect(rx, ry, rw, rh);
            }
            ctx.restore();
        }
    }

    /**
     * Apply text overlay effect
     */
    applyText(ctx, canvas, clip, currentTime) {
        const progress = this.getTransitionProgress(currentTime, clip);
        if (progress <= 0) return;

        const {
            text, posX, posY, fontSize, fontFamily,
            color, bgColor, bgEnabled, bold, italic
        } = clip;

        if (!text) return;

        const cw = canvas.width;
        const ch = canvas.height;
        const x = posX * cw;
        const y = posY * ch;
        const size = (fontSize || 24) * (cw / 1920); // Scale relative to 1080p

        ctx.save();
        ctx.globalAlpha = progress;

        // Font
        let fontStyle = '';
        if (italic) fontStyle += 'italic ';
        if (bold) fontStyle += 'bold ';
        ctx.font = `${fontStyle}${size}px ${fontFamily || 'Arial'}`;
        ctx.textBaseline = 'top';

        // Measure text
        const metrics = ctx.measureText(text);
        const textWidth = metrics.width;
        const textHeight = size * 1.3;

        // Background
        if (bgEnabled && bgColor) {
            const pad = size * 0.3;
            ctx.fillStyle = bgColor;
            ctx.beginPath();
            const bx = x - pad;
            const by = y - pad;
            const bw = textWidth + pad * 2;
            const bh = textHeight + pad * 2;
            const br = 4;
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
        }

        // Text shadow for readability
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;

        // Draw text
        ctx.fillStyle = color || '#ffffff';
        ctx.fillText(text, x, y);

        ctx.restore();
    }

    /**
     * Render all effects for current frame
     * Returns true if zoom was applied (to skip default video draw)
     */
    renderFrame(ctx, video, canvas, tracks, currentTime, playbackSpeed) {
        const speed = playbackSpeed || 1;
        let zoomApplied = false;

        // First pass: find the LAST active zoom clip
        let activeZoomClip = null;
        for (const track of tracks) {
            if (track.type !== 'zoom') continue;
            for (const clip of track.clips) {
                if (currentTime >= clip.startTime && currentTime <= clip.endTime) {
                    activeZoomClip = clip;
                }
            }
        }
        if (activeZoomClip) {
            if (this.applyZoom(ctx, video, canvas, activeZoomClip, currentTime, speed)) {
                zoomApplied = true;
            }
        }

        // Second pass: highlight effects
        for (const track of tracks) {
            if (track.type !== 'highlight') continue;
            for (const clip of track.clips) {
                if (currentTime >= clip.startTime && currentTime <= clip.endTime) {
                    this.applyHighlight(ctx, canvas, clip, currentTime);
                }
            }
        }

        // Third pass: text overlays
        for (const track of tracks) {
            if (track.type !== 'text') continue;
            for (const clip of track.clips) {
                if (currentTime >= clip.startTime && currentTime <= clip.endTime) {
                    this.applyText(ctx, canvas, clip, currentTime);
                }
            }
        }

        return zoomApplied;
    }
}

// Global instance
window.effectsEngine = new EffectsEngine();
