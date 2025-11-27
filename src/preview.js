export class PreviewPlayer {
    constructor(app) {
        this.app = app;
        this.canvas = document.getElementById('preview-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.playBtn = document.getElementById('play-pause-btn');
        this.timeDisplay = document.getElementById('time-display');

        this.isPlaying = false;
        this.animationFrame = null;
        this.lastTime = 0;

        // Set canvas size
        this.canvas.width = 1280;
        this.canvas.height = 720;

        // Active video elements pool
        this.videoPool = [];
        this.audioPool = [];

        this.initListeners();
    }

    initListeners() {
        this.playBtn.addEventListener('click', () => {
            this.togglePlay();
        });
        
        const playFromStartBtn = document.getElementById('play-from-start-btn');
        if (playFromStartBtn) {
            playFromStartBtn.addEventListener('click', () => {
                this.playFromStart();
            });
        }
    }

    togglePlay() {
        this.isPlaying = !this.isPlaying;
        this.playBtn.textContent = this.isPlaying ? '⏸' : '▶';

        if (this.isPlaying) {
            this.lastTime = performance.now();
            this.loop();
        } else {
            cancelAnimationFrame(this.animationFrame);
            this.pauseAllVideos();
        }
    }

    playFromStart() {
        // Stop current playback if playing
        if (this.isPlaying) {
            this.isPlaying = false;
            cancelAnimationFrame(this.animationFrame);
            this.pauseAllVideos();
        }
        
        // Seek to start
        this.app.timelineManager.currentTime = 0;
        this.seek(0);
        
        // Update playhead position
        this.app.timelineManager.playhead.style.transform = 'translateX(0px)';
        
        // Start playing
        this.isPlaying = true;
        this.playBtn.textContent = '⏸';
        this.lastTime = performance.now();
        this.loop();
    }

    pauseAllVideos() {
        this.videoPool.forEach(v => v.pause());
        this.audioPool.forEach(a => a.pause());
    }

    async loop() {
        if (!this.isPlaying) return;

        const now = performance.now();
        const dt = (now - this.lastTime) / 1000;
        this.lastTime = now;

        this.app.timelineManager.currentTime += dt;

        // Update playhead position visually
        const x = this.app.timelineManager.currentTime * this.app.timelineManager.zoom;
        this.app.timelineManager.playhead.style.transform = `translateX(${x}px)`;

        await this.render(this.app.timelineManager.currentTime);
        this.updateTimeDisplay(this.app.timelineManager.currentTime);

        // Get actual timeline duration based on clips
        const timelineDuration = this.app.timelineManager.getTimelineDuration();
        
        if (this.app.timelineManager.currentTime >= timelineDuration) {
            this.togglePlay();
            this.app.timelineManager.currentTime = 0;
            this.seek(0);
        } else if (this.isPlaying) {
            this.animationFrame = requestAnimationFrame(() => this.loop());
        }
    }

    seek(time) {
        this.pauseAllVideos();
        this.render(time);
        this.updateTimeDisplay(time);
    }

    async render(time, shouldSeek = true) {
        // Get all video/image clips for opacity calculation
        const allVideoClips = this.app.timelineManager.getAllClips().filter(c => c.type === 'video' || c.type === 'image');
        
        // Get clips at current time
        const clips = allVideoClips.filter(clip =>
            time >= clip.startTime && time < clip.startTime + clip.duration
        );

        // Sort by track (v1 first, then v2 on top) and then by start time
        clips.sort((a, b) => {
            if (a.trackId === 'v1' && b.trackId === 'v2') return -1;
            if (a.trackId === 'v2' && b.trackId === 'v1') return 1;
            // If same track, sort by start time (older clip first)
            if (Math.abs(a.startTime - b.startTime) > 0.001) {
                return a.startTime - b.startTime;
            }
            return a.id.localeCompare(b.id);
        });

        // --- Prepare Phase (Async) ---
        // Prepare all resources (seek videos, load images) BEFORE clearing canvas
        const drawTasks = [];

        for (const clip of clips) {
            const asset = this.app.assetsManager.getAssetById(clip.assetId);
            if (!asset) continue;

            // Calculate Opacity for Fade
            let opacity = 1.0;
            
            // 1. Check for overlap with NEXT clips (Fade Out)
            const nextClips = allVideoClips.filter(c => 
                c.id !== clip.id &&
                c.trackId === clip.trackId &&
                c.startTime > clip.startTime &&
                c.startTime < (clip.startTime + clip.duration)
            );
            
            for (const nextClip of nextClips) {
                const overlapStart = nextClip.startTime;
                const overlapEnd = Math.min(clip.startTime + clip.duration, nextClip.startTime + nextClip.duration);
                const overlapDuration = overlapEnd - overlapStart;
                const fadeOutEnd = overlapStart + overlapDuration;
                
                if (time >= overlapStart && time <= fadeOutEnd) {
                    opacity = 1.0; // Keep bottom clip opaque
                }
            }
            
            // 2. Check for overlap with PREVIOUS clips (Fade In)
            const prevClips = allVideoClips.filter(c => 
                c.id !== clip.id &&
                c.trackId === clip.trackId &&
                c.startTime < clip.startTime &&
                (c.startTime + c.duration) > clip.startTime
            );
            
            for (const prevClip of prevClips) {
                const overlapStart = clip.startTime;
                const overlapEnd = Math.min(prevClip.startTime + prevClip.duration, clip.startTime + clip.duration);
                const overlapDuration = overlapEnd - overlapStart;
                const fadeInStart = overlapStart;
                
                if (time >= fadeInStart && time <= overlapEnd) {
                    const progress = (time - fadeInStart) / overlapDuration;
                    opacity = Math.min(opacity, progress);
                } else if (time >= overlapStart && time < fadeInStart) {
                    opacity = 0.0;
                }
            }
            
            opacity = Math.max(0, Math.min(1, opacity));

            // Prepare resources
            if (clip.isImage) {
                const img = await this.prepareImage(clip, asset);
                if (img) {
                    drawTasks.push({
                        type: 'image',
                        clip,
                        asset,
                        img,
                        opacity
                    });
                }
            } else {
                const videoEl = await this.prepareVideo(clip, asset, time, shouldSeek);
                if (videoEl) {
                    drawTasks.push({
                        type: 'video',
                        clip,
                        asset,
                        videoEl,
                        opacity
                    });
                }
            }
        }

        // --- Draw Phase (Sync) ---
        // Clear canvas and draw everything at once
        this.ctx.save();
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();

        for (const task of drawTasks) {
            this.ctx.save();
            this.ctx.globalAlpha = task.opacity;

            if (task.type === 'image') {
                this.renderImageToContext(task.img, task.clip);
            } else if (task.type === 'video') {
                try {
                    if (task.videoEl.readyState >= 2) {
                        this.ctx.drawImage(task.videoEl, 0, 0, this.canvas.width, this.canvas.height);
                    }
                } catch (e) {
                    console.error('Error drawing video frame:', e);
                }
                
                // Play video if in play mode
                if (this.isPlaying && task.videoEl.paused) {
                    task.videoEl.play().catch(e => console.error('Error playing video:', e));
                }
            }

            this.ctx.restore();
        }

        // Pause videos that are no longer in the current clips list
        if (this.isPlaying) {
            this.videoPool.forEach(v => {
                const isUsed = clips.some(c => c.id === v.dataset.clipId);
                if (!isUsed && !v.paused) {
                    v.pause();
                }
            });
        }

        // Handle Audio Clips
        const audioClips = this.app.timelineManager.getAllClips().filter(clip =>
            time >= clip.startTime && time < clip.startTime + clip.duration && clip.type === 'audio'
        );

        for (const clip of audioClips) {
            const asset = this.app.assetsManager.getAssetById(clip.assetId);
            if (!asset) continue;

            let audioEl = this.getAudioElementForClip(clip.id);
            if (!audioEl) {
                audioEl = new Audio();
                audioEl.src = asset.url;
                audioEl.dataset.clipId = clip.id;
                audioEl.preload = 'auto';
                this.audioPool.push(audioEl);
            }

            // Calculate time
            const clipLocalTime = time - clip.startTime;
            const audioTime = clipLocalTime + (clip.trimStart || 0);

            // Apply Gain
            const gainDB = clip.gain || 0;
            // Convert dB to linear: 10^(dB/20)
            let volume = Math.pow(10, gainDB / 20);
            // Clamp to 0-1 for HTML Audio
            volume = Math.max(0, Math.min(1, volume));
            audioEl.volume = volume;

            // Sync Time
            if (shouldSeek && Math.abs(audioEl.currentTime - audioTime) > 0.2) {
                audioEl.currentTime = audioTime;
            }

            // Play
            if (this.isPlaying && audioEl.paused) {
                audioEl.play().catch(e => console.error('Error playing audio:', e));
            }
        }

        // Pause unused audio
        if (this.isPlaying) {
            this.audioPool.forEach(a => {
                const isUsed = audioClips.some(c => c.id === a.dataset.clipId);
                if (!isUsed && !a.paused) {
                    a.pause();
                }
            });
        }
    }

    async prepareImage(clip, asset) {
        if (!asset.imageElement) {
            asset.imageElement = new Image();
            asset.imageElement.src = asset.url;
            
            if (!asset.imageElement.complete) {
                await new Promise((resolve, reject) => {
                    asset.imageElement.onload = resolve;
                    asset.imageElement.onerror = reject;
                });
            }
        }
        return asset.imageElement;
    }

    async prepareVideo(clip, asset, time, shouldSeek) {
        let videoEl = this.getVideoElementForClip(clip.id);
        if (!videoEl) {
            videoEl = document.createElement('video');
            videoEl.src = asset.url;
            videoEl.dataset.assetId = asset.id;
            videoEl.dataset.clipId = clip.id;
            videoEl.muted = true;
            videoEl.preload = 'auto';
            this.videoPool.push(videoEl);
            
            await new Promise((resolve) => {
                if (videoEl.readyState >= 1) {
                    resolve();
                } else {
                    videoEl.addEventListener('loadedmetadata', () => resolve(), { once: true });
                    videoEl.load();
                }
            });
        }

        const clipLocalTime = time - clip.startTime;
        const videoTime = clipLocalTime + (clip.trimStart || 0);
        
        const seekThreshold = this.isPlaying ? 0.25 : 0.1;

        if (shouldSeek && Math.abs(videoEl.currentTime - videoTime) > seekThreshold) {
            videoEl.currentTime = videoTime;
            
            await new Promise((resolve) => {
                if (videoEl.readyState >= 2) {
                    resolve();
                } else {
                    const onSeeked = () => {
                        videoEl.removeEventListener('seeked', onSeeked);
                        requestAnimationFrame(() => resolve());
                    };
                    videoEl.addEventListener('seeked', onSeeked);
                    
                    setTimeout(() => {
                        videoEl.removeEventListener('seeked', onSeeked);
                        resolve();
                    }, 100);
                }
            });
        }
        return videoEl;
    }

    renderImageToContext(img, clip) {
        const scale = clip.imageScale || 1.0;
        const x = clip.imageX || 0;
        const y = clip.imageY || 0;
        const rotation = clip.imageRotation || 0;

        const scaledWidth = img.naturalWidth * scale;
        const scaledHeight = img.naturalHeight * scale;

        const prevComposite = this.ctx.globalCompositeOperation;
        this.ctx.globalCompositeOperation = 'source-over';

        this.ctx.save();
        const centerX = x + scaledWidth / 2;
        const centerY = y + scaledHeight / 2;

        this.ctx.translate(centerX, centerY);
        this.ctx.rotate(rotation * Math.PI / 180);
        
        this.ctx.drawImage(img, -scaledWidth / 2, -scaledHeight / 2, scaledWidth, scaledHeight);

        this.ctx.restore();
        this.ctx.globalCompositeOperation = prevComposite;
    }

    getVideoElementForClip(clipId) {
        return this.videoPool.find(v => v.dataset.clipId === clipId);
    }

    getAudioElementForClip(clipId) {
        return this.audioPool.find(a => a.dataset.clipId === clipId);
    }

    getVideoElement(assetId) {
        return this.videoPool.find(v => v.dataset.assetId === assetId);
    }

    updateTimeDisplay(time) {
        this.timeDisplay.textContent = this.app.timelineManager.formatTime(time);
    }

    handleResize() {
        // Handle canvas responsiveness if needed
    }
}
