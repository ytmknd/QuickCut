import { HistoryManager } from './history.js';

export class TimelineManager {
    constructor(app) {
        this.app = app;
        this.tracksContainer = document.getElementById('timeline-tracks');
        this.ruler = document.getElementById('timeline-ruler');
        this.playhead = document.getElementById('playhead');

        this.tracks = {
            v1: [],
            v2: [],
            a1: [],
            a2: []
        };

        this.duration = 60; // Default 60 seconds timeline
        this.zoom = 10; // pixels per second
        this.currentTime = 0;
        this.isScrubbing = false;
        this.isDraggingClip = false;
        this.isDraggingPlayhead = false;
        this.draggedClip = null;
        this.dragOffsetX = 0; // Offset from clip start to mouse position
        this.selectedClips = [];
        this.clipboardClips = []; // Copied clips data
        this.snapEnabled = true; // Enable snap by default
        this.snapThreshold = 0.5; // Snap threshold in seconds (adjusts with zoom)
        this.isTrimmingClip = false;
        this.trimMode = null; // 'start' or 'end'
        this.trimClip = null;
        this.trimStartX = 0;
        this.trimOriginalStart = 0;
        this.trimOriginalDuration = 0;
        this.trimOriginalTrimStart = 0;

        this.isInteractive = true; // Flag to control timeline interactivity

        this.isDraggingGain = false;
        this.draggedGainClip = null;



        this.historyManager = new HistoryManager(this);

        this.createContextMenu();
        this.initListeners();
        this.renderRuler();
    }

    initListeners() {
        // Zoom controls
        const zoomInBtn = document.getElementById('zoom-in-btn');
        const zoomOutBtn = document.getElementById('zoom-out-btn');
        const zoomSlider = document.getElementById('zoom-slider');

        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', () => {
                this.zoomIn();
            });
        }

        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', () => {
                this.zoomOut();
            });
        }

        if (zoomSlider) {
            zoomSlider.addEventListener('input', (e) => {
                this.setZoom(parseFloat(e.target.value));
            });
        }

        // Mouse wheel zoom
        this.tracksContainer.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -1 : 1;
                this.adjustZoom(delta);
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.matches('input, textarea')) return;

            if (e.key === '+' || e.key === '=') {
                this.zoomIn();
            } else if (e.key === '-' || e.key === '_') {
                this.zoomOut();
            }
        });

        // Playhead dragging
        this.playhead.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.isDraggingPlayhead = true;
            this.isScrubbing = true;
        });

        // Sync ruler scroll with tracks scroll
        this.tracksContainer.addEventListener('scroll', () => {
            const scrollLeft = this.tracksContainer.scrollLeft;
            this.ruler.style.transform = `translateX(-${scrollLeft}px)`;
        });

        // Drag and drop on tracks
        const trackEls = document.querySelectorAll('.track');
        trackEls.forEach(trackEl => {
            trackEl.addEventListener('dragover', (e) => {
                if (!this.isInteractive) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
            });

            trackEl.addEventListener('drop', (e) => {
                if (!this.isInteractive) return;
                e.preventDefault();
                const data = e.dataTransfer.getData('application/json');
                if (data) {
                    const asset = JSON.parse(data);
                    const trackId = trackEl.dataset.id;
                    const rect = trackEl.getBoundingClientRect();
                    const offsetX = e.clientX - rect.left + this.tracksContainer.scrollLeft;
                    const startTime = offsetX / this.zoom;

                    this.addClip(trackId, asset, startTime);
                }
            });
        });

        // Scrubbing
        this.ruler.addEventListener('mousedown', (e) => {
            this.isScrubbing = true;
            this.updatePlayhead(e);
        });

        // Scrubbing and clip dragging on tracks area
        this.tracksContainer.addEventListener('mousedown', (e) => {
            if (e.button === 2) return; // Ignore right click for mousedown
            if (e.target.classList.contains('trim-handle-start')) {
                if (!this.isInteractive) return;
                // Start trimming from start
                e.stopPropagation();
                this.startTrimming(e, 'start');
            } else if (e.target.classList.contains('trim-handle-end')) {
                if (!this.isInteractive) return;
                // Start trimming from end
                e.stopPropagation();
                this.startTrimming(e, 'end');
            } else if (e.target.classList.contains('clip') || e.target.closest('.clip')) {
                if (!this.isInteractive) return;
                const clipEl = e.target.classList.contains('clip') ? e.target : e.target.closest('.clip');
                const clipId = clipEl.dataset.id;

                // Find the clip
                let clickedClip = null;
                for (const trackId in this.tracks) {
                    const clip = this.tracks[trackId].find(c => c.id === clipId);
                    if (clip) {
                        clickedClip = clip;
                        break;
                    }
                }

                if (clickedClip) {
                    // If clicking on already selected clip, allow dragging
                    const isSelected = this.selectedClips.some(c => c.id === clickedClip.id);
                    if (isSelected && !e.shiftKey) {
                        // Only start drag if clicking on clip content, not handles
                        if (e.target.classList.contains('clip-content') || e.target.classList.contains('clip')) {
                            e.stopPropagation();
                            this.startClipDrag(e);
                        }
                    } else {
                        // Select the clip (no drag on first click if not selected)
                        this.selectClip(clickedClip, e.shiftKey);
                    }
                }
            } else {
                // Deselect clip when clicking on empty area
                this.deselectClip();
                // Start scrubbing
                this.isScrubbing = true;
                this.updatePlayheadFromTracks(e);
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (this.isDraggingPlayhead) {
                // Prioritize playhead dragging
                this.updatePlayheadFromTracks(e);
            } else if (this.isScrubbing) {
                if (e.target.closest('#timeline-ruler')) {
                    this.updatePlayhead(e);
                } else if (e.target.closest('#timeline-tracks')) {
                    this.updatePlayheadFromTracks(e);
                }
            }
            if (this.isDraggingClip) {
                this.handleClipDrag(e);
            }
            if (this.isTrimmingClip) {
                this.handleTrimDrag(e);
            }
            if (this.isDraggingGain) {
                this.handleGainDrag(e);
            }
        });

        document.addEventListener('mouseup', (e) => {
            // If we were dragging the playhead, ensure preview is updated
            if (this.isDraggingPlayhead) {
                this.app.previewPlayer.seek(this.currentTime);
            }

            this.isScrubbing = false;
            this.isDraggingClip = false;
            this.isDraggingPlayhead = false;
            this.isTrimmingClip = false;
            this.isDraggingGain = false;
            this.draggedClip = null;
            this.trimClip = null;
            this.trimMode = null;
            this.draggedGainClip = null;
        });

        // Context Menu
        this.tracksContainer.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const clipEl = e.target.closest('.clip');
            if (clipEl) {
                const clipId = clipEl.dataset.id;
                let clip = null;
                for (const trackId in this.tracks) {
                    clip = this.tracks[trackId].find(c => c.id === clipId);
                    if (clip) break;
                }
                
                if (clip) {
                    // If the clicked clip is not in the current selection, select it (and deselect others)
                    const isSelected = this.selectedClips.some(c => c.id === clip.id);
                    if (!isSelected) {
                        this.selectClip(clip, false);
                    }
                    
                    this.showContextMenu(e.clientX, e.clientY, clip);
                }
            }
        });

        document.addEventListener('click', (e) => {
            if (this.contextMenu && !this.contextMenu.contains(e.target)) {
                this.hideContextMenu();
            }
        });
    }

    createContextMenu() {
        this.contextMenu = document.createElement('div');
        this.contextMenu.className = 'context-menu';
        this.contextMenu.style.display = 'none';
        
        // Save Clip Item
        this.saveClipItem = document.createElement('div');
        this.saveClipItem.className = 'context-menu-item';
        this.saveClipItem.textContent = 'クリップを名前を付けて保存';
        this.saveClipItem.addEventListener('click', () => {
            if (this.contextMenuClip) {
                const filename = prompt('ファイル名を入力してください', 'clip');
                if (filename) {
                    this.app.exporter.exportSingleClip(this.contextMenuClip, filename);
                }
            }
            this.hideContextMenu();
        });
        this.contextMenu.appendChild(this.saveClipItem);

        // Merge Clips Item
        this.mergeClipsItem = document.createElement('div');
        this.mergeClipsItem.className = 'context-menu-item';
        this.mergeClipsItem.textContent = 'クリップを連結';
        this.mergeClipsItem.addEventListener('click', () => {
            this.mergeSelectedClips();
            this.hideContextMenu();
        });
        this.contextMenu.appendChild(this.mergeClipsItem);

        // Cut Clip Item
        this.cutClipItem = document.createElement('div');
        this.cutClipItem.className = 'context-menu-item';
        this.cutClipItem.textContent = '再生ヘッド位置で分割';
        this.cutClipItem.addEventListener('click', () => {
            if (this.contextMenuClip) {
                this.performCut(this.contextMenuClip, this.currentTime);
            }
            this.hideContextMenu();
        });
        this.contextMenu.appendChild(this.cutClipItem);

        document.body.appendChild(this.contextMenu);
    }

    showContextMenu(x, y, clip) {
        this.contextMenuClip = clip;
        
        // Determine which items to show
        let showSave = false;
        let showMerge = false;
        let showCut = true;

        // Show Save if single video/audio clip
        if (this.selectedClips.length <= 1) {
            if ((clip.type === 'video' || clip.type === 'audio') && !clip.isImage) {
                showSave = true;
            }
        }

        // Show Merge if exactly 2 clips selected
        if (this.selectedClips.length === 2) {
            showMerge = true;
        }

        // Validate cut time (must be within clip duration, not at edges)
        // Check if playhead is within the clip
        const margin = 0.05;
        if (this.currentTime <= clip.startTime + margin || this.currentTime >= clip.startTime + clip.duration - margin) {
            showCut = false;
        }

        this.saveClipItem.style.display = showSave ? 'block' : 'none';
        this.mergeClipsItem.style.display = showMerge ? 'block' : 'none';
        this.cutClipItem.style.display = showCut ? 'block' : 'none';

        if (!showSave && !showMerge && !showCut) return;

        // Adjust position to keep within viewport
        let left = x;
        let top = y;
        
        // We need to show it to get dimensions, but visibility hidden
        this.contextMenu.style.visibility = 'hidden';
        this.contextMenu.style.display = 'block';
        
        const menuRect = this.contextMenu.getBoundingClientRect();
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;
        
        if (left + menuRect.width > winWidth) {
            left = winWidth - menuRect.width - 10;
        }
        
        if (top + menuRect.height > winHeight) {
            top = winHeight - menuRect.height - 10;
        }
        
        this.contextMenu.style.left = `${left}px`;
        this.contextMenu.style.top = `${top}px`;
        this.contextMenu.style.visibility = 'visible';
    }

    mergeSelectedClips() {
        if (this.selectedClips.length !== 2) return;

        // Sort by start time
        const sortedClips = [...this.selectedClips].sort((a, b) => a.startTime - b.startTime);
        const first = sortedClips[0];
        const second = sortedClips[1];

        // 1. Check if on same track
        if (first.trackId !== second.trackId) {
            alert('同じトラック上のクリップのみ連結できます。');
            return;
        }

        // 2. Check adjacency (allow small gap/overlap due to float precision)
        const gap = Math.abs(second.startTime - (first.startTime + first.duration));
        if (gap > 0.1) { // 0.1s tolerance
            // Ignore non-adjacent clips as requested
            console.log('Clips are not adjacent, ignoring merge request.');
            return;
        }

        // 3. Check if same asset
        if (first.assetId !== second.assetId) {
            alert('同じ素材（アセット）のクリップのみ連結できます。');
            return;
        }

        // 4. Check if continuous in source time
        // The end of first clip in source time should match start of second clip in source time
        const firstEndSource = (first.trimStart || 0) + first.duration;
        const secondStartSource = (second.trimStart || 0);
        
        if (Math.abs(firstEndSource - secondStartSource) > 0.1) {
             alert('元動画の連続した部分ではないため連結できません。');
             return;
        }

        // Perform Merge
        this.historyManager.pushState();

        // Extend first clip
        first.duration += second.duration;

        // Remove second clip
        const track = this.tracks[second.trackId];
        const idx = track.indexOf(second);
        if (idx > -1) {
            track.splice(idx, 1);
        }

        // Update selection to just the merged clip
        this.selectedClips = [first];
        
        // Update DOM
        this.updateAllClips();
        this.updatePropertiesPanel();
    }

    hideContextMenu() {
        if (this.contextMenu) {
            this.contextMenu.style.display = 'none';
        }
        this.contextMenuClip = null;
    }

    startClipDrag(e) {
        this.historyManager.pushState();
        this.isDraggingClip = true;
        const clipEl = e.target.classList.contains('clip') ? e.target : e.target.closest('.clip');
        const clipId = clipEl.dataset.id;

        // Calculate the offset from the clip's left edge to the mouse position
        const clipRect = clipEl.getBoundingClientRect();
        this.dragOffsetX = e.clientX - clipRect.left;

        // Find clip object
        for (const trackId in this.tracks) {
            const clip = this.tracks[trackId].find(c => c.id === clipId);
            if (clip) {
                this.draggedClip = clip;
                break;
            }
        }

        if (this.draggedClip) {
            this.dragStartX = e.clientX;

            // Capture state of ALL selected clips
            this.draggedClipsState = this.selectedClips.map(clip => ({
                clip: clip,
                originalStartTime: clip.startTime,
                originalTrackId: clip.trackId,
                originalTrimStart: clip.trimStart || 0
            }));

            this.slideState = null; // Reset slide state
        }
    }

    handleClipDrag(e) {
        if (!this.draggedClip || !this.draggedClipsState) return;

        // Normal Drag Logic
        const tracksRect = this.tracksContainer.getBoundingClientRect();
        const mouseXInTracks = e.clientX - tracksRect.left + this.tracksContainer.scrollLeft;

        // Calculate raw delta time based on mouse movement for the PRIMARY clip
        const clipLeftX = mouseXInTracks - this.dragOffsetX;
        let primaryNewStartTime = clipLeftX / this.zoom;
        primaryNewStartTime = Math.max(0, primaryNewStartTime);

        if (this.snapEnabled) {
            primaryNewStartTime = this.getSnappedTime(primaryNewStartTime, this.draggedClip);
        }

        // Calculate delta from original position
        const primaryState = this.draggedClipsState.find(s => s.clip.id === this.draggedClip.id);
        if (!primaryState) return;

        const deltaTime = primaryNewStartTime - primaryState.originalStartTime;

        // Determine target track for PRIMARY clip
        let primaryTargetTrackId = this.draggedClip.trackId;
        const elements = document.elementsFromPoint(e.clientX, e.clientY);
        const trackEl = elements.find(el => el.classList.contains('track'));

        if (trackEl) {
            const newTrackId = trackEl.dataset.id;
            const newTrackType = trackEl.dataset.type;
            if (newTrackType === this.draggedClip.type) {
                primaryTargetTrackId = newTrackId;
            }
        }

        // Calculate Track Index Delta
        const trackOrder = ['v1', 'v2', 'a1', 'a2'];
        const primaryOriginalTrackIndex = trackOrder.indexOf(primaryState.originalTrackId);
        const primaryTargetTrackIndex = trackOrder.indexOf(primaryTargetTrackId);
        const trackIndexDelta = primaryTargetTrackIndex - primaryOriginalTrackIndex;

        // Check validity of the move for ALL clips
        let canMoveTracks = true;

        // First pass: Calculate proposed states
        const proposedMoves = this.draggedClipsState.map(state => {
            let newStartTime = state.originalStartTime + deltaTime;
            newStartTime = Math.max(0, newStartTime);

            let newTrackId = state.originalTrackId;
            if (trackIndexDelta !== 0) {
                const currentTrackIndex = trackOrder.indexOf(state.originalTrackId);
                const targetTrackIndex = currentTrackIndex + trackIndexDelta;
                if (targetTrackIndex >= 0 && targetTrackIndex < trackOrder.length) {
                    const targetTrackId = trackOrder[targetTrackIndex];
                    // Check type compatibility (video->video, audio->audio)
                    const isVideo = state.clip.type === 'video';
                    const isTargetVideo = targetTrackId.startsWith('v');
                    if ((isVideo && isTargetVideo) || (!isVideo && !isTargetVideo)) {
                        newTrackId = targetTrackId;
                    } else {
                        canMoveTracks = false;
                    }
                } else {
                    canMoveTracks = false;
                }
            }

            return {
                clip: state.clip,
                newStartTime,
                newTrackId,
                duration: state.clip.duration,
                id: state.clip.id
            };
        });

        // If track move is invalid for any, reset all track moves
        if (!canMoveTracks) {
            proposedMoves.forEach(m => m.newTrackId = this.draggedClipsState.find(s => s.clip.id === m.clip.id).originalTrackId);
        }

        // Check collisions for ALL proposed moves
        const selectedIds = this.selectedClips.map(c => c.id);
        for (const move of proposedMoves) {
            if (this.checkOverlap(move.newTrackId, move.newStartTime, move.duration, selectedIds)) {
                return; // Abort move if any collision
            }
        }

        // Apply updates
        proposedMoves.forEach(move => {
            const clip = move.clip;

            // Handle Track Change
            if (move.newTrackId !== clip.trackId) {
                // Remove from old
                const oldTrackList = this.tracks[clip.trackId];
                const idx = oldTrackList.indexOf(clip);
                if (idx > -1) oldTrackList.splice(idx, 1);

                // Add to new
                clip.trackId = move.newTrackId;
                this.tracks[move.newTrackId].push(clip);

                // Move DOM
                const el = document.querySelector(`.clip[data-id="${clip.id}"]`);
                const newTrackEl = document.querySelector(`.track[data-id="${move.newTrackId}"]`);
                if (el && newTrackEl) newTrackEl.appendChild(el);
            }

            // Update Time
            clip.startTime = move.newStartTime;
            const el = document.querySelector(`.clip[data-id="${clip.id}"]`);
            if (el) el.style.left = `${clip.startTime * this.zoom}px`;
        });
    }



    addClip(trackId, asset, startTime) {
        this.historyManager.pushState();
        
        // Get the latest asset info from manager to ensure we have the duration
        // (in case it was loaded after drag started)
        const storedAsset = this.app.assetsManager.getAssetById(asset.id);
        const duration = (storedAsset && storedAsset.duration) ? storedAsset.duration : (asset.duration || 5);

        // Check for triple overlap
        if (this.checkOverlap(trackId, startTime, duration, [])) {
            alert('Cannot place clip here: Maximum overlap of 2 clips reached.');
            return;
        }

        // Simple collision check could go here
        const clip = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            assetId: asset.id,
            startTime: startTime,
            duration: duration,
            trimStart: 0,
            trackId: trackId,
            type: asset.type === 'image' ? 'video' : asset.type, // Treat images as video clips
            isImage: asset.type === 'image',
            // Image-specific properties
            imageX: 0,
            imageY: 0,
            imageScale: 1.0,
            imageRotation: 0,
            // Audio properties
            gain: 0 // dB
        };

        // If it's a video, get duration (async in reality, simplified here)
        // For now we assume 5s or update later

        this.tracks[trackId].push(clip);
        this.renderClip(clip);

        // Update timeline duration
        this.updateTimelineDuration();
    }

    updateTimelineDuration() {
        const newDuration = this.getTimelineDuration();
        if (newDuration !== this.duration) {
            this.duration = newDuration;
            this.renderRuler();
        }
    }

    renderClip(clip) {
        const trackEl = document.querySelector(`.track[data-id="${clip.trackId}"]`);
        const el = document.createElement('div');
        el.className = `clip ${clip.type}`;
        el.style.left = `${clip.startTime * this.zoom}px`;
        el.style.width = `${clip.duration * this.zoom}px`;
        el.dataset.id = clip.id;

        // Add thumbnail for video clips
        if (clip.type === 'video') {
            const thumbnail = document.createElement('canvas');
            thumbnail.className = 'clip-thumbnail';
            thumbnail.width = 80;
            thumbnail.height = 60;
            el.appendChild(thumbnail);

            // Generate thumbnail
            this.generateThumbnail(thumbnail, clip);
        }

        // Add waveform canvas for audio clips
        if (clip.type === 'audio') {
            const waveformCanvas = document.createElement('canvas');
            waveformCanvas.className = 'waveform-canvas';
            waveformCanvas.width = clip.duration * this.zoom;
            waveformCanvas.height = 60; // Track height
            el.appendChild(waveformCanvas);

            // Draw waveform
            this.drawWaveform(waveformCanvas, clip);
        }

        // Add gain line for audio clips
        if (clip.type === 'audio') {
            const gainLine = document.createElement('div');
            gainLine.className = 'gain-line';
            // Calculate top position based on gain
            const y = this.getNormalizedYFromDB(clip.gain || 0);
            gainLine.style.top = `${(1 - y) * 100}%`;

            // Add drag handle behavior
            gainLine.addEventListener('mousedown', (e) => {
                e.stopPropagation(); // Prevent clip drag
                this.startGainDrag(e, clip);
            });

            el.appendChild(gainLine);
        }

        // Clip content
        const content = document.createElement('div');
        content.className = 'clip-content';
        content.textContent = this.app.assetsManager.getAssetById(clip.assetId).name;
        el.appendChild(content);

        // Trim handles
        const handleStart = document.createElement('div');
        handleStart.className = 'trim-handle trim-handle-start';
        el.appendChild(handleStart);

        const handleEnd = document.createElement('div');
        handleEnd.className = 'trim-handle trim-handle-end';
        el.appendChild(handleEnd);

        trackEl.appendChild(el);
    }

    updatePlayhead(e) {
        const rect = this.ruler.getBoundingClientRect();
        let x = e.clientX - rect.left + this.tracksContainer.scrollLeft;
        x = Math.max(0, x);

        this.currentTime = x / this.zoom;
        const displayX = x - this.tracksContainer.scrollLeft;
        this.playhead.style.transform = `translateX(${x}px)`;

        // Update time display
        const timeDisplay = document.getElementById('time-display');
        if (timeDisplay) {
            timeDisplay.textContent = this.formatTime(this.currentTime);
        }

        // Update preview
        this.app.previewPlayer.seek(this.currentTime);
    }

    updatePlayheadFromTracks(e) {
        const rect = this.tracksContainer.getBoundingClientRect();
        let x = e.clientX - rect.left + this.tracksContainer.scrollLeft;
        x = Math.max(0, x);

        this.currentTime = x / this.zoom;
        this.playhead.style.transform = `translateX(${x}px)`;

        // Update time display
        const timeDisplay = document.getElementById('time-display');
        if (timeDisplay) {
            timeDisplay.textContent = this.formatTime(this.currentTime);
        }

        // Update preview
        this.app.previewPlayer.seek(this.currentTime);
    }

    renderRuler() {
        // Simple ruler rendering
        this.ruler.innerHTML = '';
        const totalWidth = this.duration * this.zoom;
        this.ruler.style.width = `${totalWidth}px`;

        // Update tracks width to match ruler
        const tracks = this.tracksContainer.querySelectorAll('.track');
        tracks.forEach(track => {
            track.style.width = `${totalWidth}px`;
        });

        // Dynamic step size based on zoom
        // We want ticks roughly every 100px
        let step = 100 / this.zoom;
        
        // Round step to nice numbers
        if (step < 1) step = 1;
        else if (step < 2) step = 2;
        else if (step < 5) step = 5;
        else if (step < 10) step = 10;
        else if (step < 30) step = 30;
        else if (step < 60) step = 60;
        else if (step < 300) step = 300; // 5 min
        else step = 600; // 10 min

        for (let i = 0; i <= this.duration; i += step) {
            const tick = document.createElement('div');
            tick.style.position = 'absolute';
            tick.style.left = `${i * this.zoom}px`;
            tick.style.height = '100%';
            tick.style.borderLeft = '1px solid #555';
            tick.style.fontSize = '10px';
            tick.style.paddingLeft = '2px';
            tick.textContent = this.formatTime(i);
            this.ruler.appendChild(tick);
        }
    }

    formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    handleResize() {
        this.renderRuler();
    }

    getAllClips() {
        let all = [];
        Object.values(this.tracks).forEach(trackClips => {
            all = all.concat(trackClips);
        });
        return all;
    }

    getTimelineDuration() {
        // Calculate the end time of the last clip
        let maxEndTime = 60; // Default minimum duration
        const allClips = this.getAllClips();

        if (allClips.length > 0) {
            allClips.forEach(clip => {
                const clipEndTime = clip.startTime + clip.duration;
                if (clipEndTime > maxEndTime) {
                    maxEndTime = clipEndTime;
                }
            });
        }

        return maxEndTime;
    }

    cutClipAtPlayhead() {
        this.historyManager.pushState();
        const currentTime = this.currentTime;

        // If clips are selected, cut them
        if (this.selectedClips.length > 0) {
            // Create a copy of the array to avoid issues while modifying the selection during iteration
            const clipsToCut = [...this.selectedClips];
            let cutCount = 0;

            clipsToCut.forEach(clip => {
                const clipStartTime = clip.startTime;
                const clipEndTime = clip.startTime + clip.duration;

                // Check if playhead is within this clip (not at the edges)
                if (currentTime > clipStartTime && currentTime < clipEndTime) {
                    this.performCut(clip, currentTime);
                    cutCount++;
                }
            });

            if (cutCount > 0) {
                console.log(`${cutCount} selected clips cut at ${currentTime} seconds`);
            } else {
                console.log('Playhead is not within any selected clip');
            }
            return;
        }

        // If no clip is selected, cut the first clip found at playhead position
        let clipWasCut = false;
        for (const trackId in this.tracks) {
            const trackClips = this.tracks[trackId];

            for (let i = 0; i < trackClips.length; i++) {
                const clip = trackClips[i];
                const clipStartTime = clip.startTime;
                const clipEndTime = clip.startTime + clip.duration;

                // Check if playhead is within this clip (not at the edges)
                if (currentTime > clipStartTime && currentTime < clipEndTime) {
                    this.performCut(clip, currentTime);
                    clipWasCut = true;
                    console.log('Clip cut at', currentTime, 'seconds');
                    break;
                }
            }
            if (clipWasCut) break;
        }

        if (!clipWasCut) {
            console.log('No clip at playhead position to cut');
        }
    }

    performCut(clip, cutTime) {
        const trackClips = this.tracks[clip.trackId];
        const clipIndex = trackClips.indexOf(clip);

        const clipStartTime = clip.startTime;
        const clipEndTime = clip.startTime + clip.duration;
        const firstClipDuration = cutTime - clipStartTime;
        const secondClipDuration = clipEndTime - cutTime;

        // Create the second clip (right side)
        const newClip = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            assetId: clip.assetId,
            startTime: cutTime,
            duration: secondClipDuration,
            trackId: clip.trackId,
            type: clip.type,
            trimStart: (clip.trimStart || 0) + firstClipDuration
        };

        // Update the first clip (left side)
        clip.duration = firstClipDuration;

        // Add trimStart if not already set
        if (!clip.trimStart) {
            clip.trimStart = 0;
        }

        // Insert the new clip into the track
        trackClips.splice(clipIndex + 1, 0, newClip);

        // Update DOM
        this.updateClipElement(clip);
        this.renderClip(newClip);

        // Update timeline duration
        this.updateTimelineDuration();

        // Select the left clip after cutting
        this.selectClip(clip);
    }

    selectClip(clip, shiftKey = false) {
        if (shiftKey) {
            // Toggle selection
            const index = this.selectedClips.findIndex(c => c.id === clip.id);
            if (index > -1) {
                // Deselect
                this.selectedClips.splice(index, 1);
                const el = document.querySelector(`.clip[data-id="${clip.id}"]`);
                if (el) el.classList.remove('selected');
            } else {
                // Select
                this.selectedClips.push(clip);
                const el = document.querySelector(`.clip[data-id="${clip.id}"]`);
                if (el) el.classList.add('selected');
            }
        } else {
            // Single selection
            this.deselectClip();
            this.selectedClips = [clip];
            const el = document.querySelector(`.clip[data-id="${clip.id}"]`);
            if (el) el.classList.add('selected');
        }

        // Update properties panel (show info for the last selected clip)
        this.updatePropertiesPanel();

        console.log('Selected clips:', this.selectedClips.map(c => c.id));
    }

    deselectClip() {
        this.selectedClips.forEach(clip => {
            const el = document.querySelector(`.clip[data-id="${clip.id}"]`);
            if (el) {
                el.classList.remove('selected');
            }
        });
        this.selectedClips = [];

        // Clear properties panel
        this.updatePropertiesPanel();
    }

    deleteSelectedClip() {
        if (this.selectedClips.length === 0) {
            console.log('No clips selected to delete');
            return;
        }
        this.historyManager.pushState();

        // Create a copy to iterate safely
        const clipsToDelete = [...this.selectedClips];

        clipsToDelete.forEach(clip => {
            const trackClips = this.tracks[clip.trackId];

            // Find and remove clip from track
            const index = trackClips.indexOf(clip);
            if (index > -1) {
                trackClips.splice(index, 1);
            }

            // Remove DOM element
            const el = document.querySelector(`.clip[data-id="${clip.id}"]`);
            if (el) {
                el.remove();
            }

            // Remove associated video element from pool
            const videoElIndex = this.app.previewPlayer.videoPool.findIndex(v => v.dataset.clipId === clip.id);
            if (videoElIndex > -1) {
                const videoEl = this.app.previewPlayer.videoPool[videoElIndex];
                videoEl.pause();
                videoEl.src = '';
                this.app.previewPlayer.videoPool.splice(videoElIndex, 1);
            }
        });

        console.log('Clips deleted:', clipsToDelete.map(c => c.id));
        this.selectedClips = [];

        // Update timeline duration
        this.updateTimelineDuration();

        // Update preview
        this.app.previewPlayer.seek(this.currentTime);
    }

    copySelectedClip() {
        if (this.selectedClips.length === 0) {
            console.log('No clip selected to copy');
            return;
        }

        // Calculate minimum start time to use as reference
        const minStartTime = Math.min(...this.selectedClips.map(c => c.startTime));

        this.clipboardClips = this.selectedClips.map(clip => ({
            assetId: clip.assetId,
            duration: clip.duration,
            trackId: clip.trackId,
            type: clip.type,
            trimStart: clip.trimStart || 0,
            offsetFromStart: clip.startTime - minStartTime
        }));

        console.log('Clips copied:', this.clipboardClips.length);
    }

    cutSelectedClip() {
        if (this.selectedClips.length === 0) {
            console.log('No clip selected to cut');
            return;
        }
        this.copySelectedClip();
        this.deleteSelectedClip();
        console.log('Clips cut');
    }

    pasteClip() {
        if (this.clipboardClips.length === 0) {
            console.log('No clips in clipboard to paste');
            return;
        }
        this.historyManager.pushState();

        const newClips = [];

        this.clipboardClips.forEach(clipboardClip => {
            // Create a new clip at the playhead position + offset
            const newStartTime = this.currentTime + clipboardClip.offsetFromStart;

            const newClip = {
                id: Date.now() + Math.random().toString(36).substr(2, 9),
                assetId: clipboardClip.assetId,
                startTime: newStartTime,
                duration: clipboardClip.duration,
                trackId: clipboardClip.trackId,
                type: clipboardClip.type,
                trimStart: clipboardClip.trimStart
            };

            this.tracks[newClip.trackId].push(newClip);
            this.renderClip(newClip);
            newClips.push(newClip);
        });

        // Select the newly pasted clips
        this.deselectClip();
        newClips.forEach(clip => this.selectClip(clip, true)); // true for multi-select

        // Update timeline duration
        this.updateTimelineDuration();

        // Update preview
        this.app.previewPlayer.seek(this.currentTime);

        console.log('Clips pasted:', newClips.length);
    }

    toggleSnap() {
        this.snapEnabled = !this.snapEnabled;
        console.log('Snap', this.snapEnabled ? 'enabled' : 'disabled');
    }

    isAssetInUse(assetId) {
        // Check all tracks for clips using this asset
        for (const trackId in this.tracks) {
            const found = this.tracks[trackId].some(clip => clip.assetId === assetId);
            if (found) return true;
        }
        return false;
    }

    checkOverlap(trackId, startTime, duration, excludeClipIds = []) {
        const trackClips = this.tracks[trackId];
        if (!trackClips) return false;

        // Ensure excludeClipIds is an array
        const excludes = Array.isArray(excludeClipIds) ? excludeClipIds : [excludeClipIds];

        const newStart = startTime;
        const newEnd = startTime + duration;

        // 1. Find all clips that overlap with the new range
        const overlappingClips = trackClips.filter(clip => {
            if (excludes.includes(clip.id)) return false;
            const clipStart = clip.startTime;
            const clipEnd = clip.startTime + clip.duration;
            // Check for overlap: (StartA < EndB) and (EndA > StartB)
            return (clipStart < newEnd && clipEnd > newStart);
        });

        // If 0 or 1 clip overlaps, it's fine (max 2 layers including new one)
        if (overlappingClips.length < 2) return false;

        // 2. Check if any two overlapping clips also overlap with each other
        // If they do, adding a third one would create a triple overlap
        for (let i = 0; i < overlappingClips.length; i++) {
            for (let j = i + 1; j < overlappingClips.length; j++) {
                const clipA = overlappingClips[i];
                const clipB = overlappingClips[j];

                const startA = clipA.startTime;
                const endA = clipA.startTime + clipA.duration;
                const startB = clipB.startTime;
                const endB = clipB.startTime + clipB.duration;

                // Check intersection of A and B
                const intersectionStart = Math.max(startA, startB);
                const intersectionEnd = Math.min(endA, endB);

                if (intersectionStart < intersectionEnd) {
                    // A and B overlap. Now check if this intersection overlaps with new range.
                    // Since both A and B are in overlappingClips, they both overlap with new range.
                    // We need to check if there is a common time point for A, B, and New.

                    const commonStart = Math.max(intersectionStart, newStart);
                    const commonEnd = Math.min(intersectionEnd, newEnd);

                    if (commonStart < commonEnd) {
                        return true; // Triple overlap detected
                    }
                }
            }
        }

        return false;
    }

    updatePropertiesPanel() {
        const propertiesContent = document.getElementById('properties-content');
        if (!propertiesContent) return;

        if (!this.selectedClip) {
            propertiesContent.innerHTML = '<div class="no-selection">No clip selected</div>';
            return;
        }

        const clip = this.selectedClip;
        const asset = this.app.assetsManager.getAssetById(clip.assetId);

        let html = `
            <div class="property-group">
                <div class="property-label">Clip Name</div>
                <div class="property-value">${asset.name}</div>
            </div>
            <div class="property-group">
                <div class="property-label">Duration</div>
                <div class="property-value">${clip.duration.toFixed(2)}s</div>
            </div>
        `;

        // Show image properties if it's an image clip
        if (clip.isImage) {
            html += `
                <div class="property-group">
                    <label class="property-label">X Position</label>
                    <input type="number" id="prop-x" class="property-input" value="${clip.imageX || 0}" step="10">
                </div>
                <div class="property-group">
                    <label class="property-label">Y Position</label>
                    <input type="number" id="prop-y" class="property-input" value="${clip.imageY || 0}" step="10">
                </div>
                <div class="property-group">
                    <label class="property-label">Scale</label>
                    <input type="number" id="prop-scale" class="property-input" value="${clip.imageScale || 1}" step="0.1" min="0.1" max="5">
                </div>
                <div class="property-group">
                    <label class="property-label">Rotation (deg)</label>
                    <input type="number" id="prop-rotation" class="property-input" value="${clip.imageRotation || 0}" step="1" min="0" max="360">
                </div>
            `;
        }

        // Show audio properties if it's an audio clip
        if (clip.type === 'audio') {
            html += `
                <div class="property-group">
                    <label class="property-label">Gain (dB)</label>
                    <input type="number" id="prop-gain" class="property-input" value="${(clip.gain || 0).toFixed(1)}" step="0.5" min="-60" max="10">
                </div>
            `;
        }

        propertiesContent.innerHTML = html;

        // Add event listeners for image properties
        if (clip.isImage) {
            const propX = document.getElementById('prop-x');
            const propY = document.getElementById('prop-y');
            const propScale = document.getElementById('prop-scale');

            if (propX) {
                propX.addEventListener('input', (e) => {
                    clip.imageX = parseFloat(e.target.value) || 0;
                    this.app.previewPlayer.render(this.currentTime);
                });
            }

            if (propY) {
                propY.addEventListener('input', (e) => {
                    clip.imageY = parseFloat(e.target.value) || 0;
                    this.app.previewPlayer.render(this.currentTime);
                });
            }

            if (propScale) {
                propScale.addEventListener('input', (e) => {
                    clip.imageScale = parseFloat(e.target.value) || 1;
                    this.app.previewPlayer.render(this.currentTime);
                });
            }

            const propRotation = document.getElementById('prop-rotation');
            if (propRotation) {
                propRotation.addEventListener('input', (e) => {
                    clip.imageRotation = parseFloat(e.target.value) || 0;
                    this.app.previewPlayer.render(this.currentTime);
                });
            }
        }

        // Add event listeners for audio properties
        if (clip.type === 'audio') {
            const propGain = document.getElementById('prop-gain');
            if (propGain) {
                propGain.addEventListener('input', (e) => {
                    let val = parseFloat(e.target.value);
                    if (isNaN(val)) val = 0;
                    // Clamp
                    val = Math.max(-60, Math.min(10, val));
                    clip.gain = val;
                    this.updateClipElement(clip);
                    // Update preview volume if playing
                    // This will be handled by the render loop or we can force an update
                });
            }
        }
    }

    updateClipElement(clip) {
        const el = document.querySelector(`.clip[data-id="${clip.id}"]`);
        if (el) {
            el.style.left = `${clip.startTime * this.zoom}px`;
            el.style.width = `${clip.duration * this.zoom}px`;

            // Update waveform canvas if audio clip
            if (clip.type === 'audio') {
                const canvas = el.querySelector('.waveform-canvas');
                if (canvas) {
                    canvas.width = clip.duration * this.zoom;
                    this.drawWaveform(canvas, clip);
                }

                const gainLine = el.querySelector('.gain-line');
                if (gainLine) {
                    const y = this.getNormalizedYFromDB(clip.gain || 0);
                    gainLine.style.top = `${(1 - y) * 100}%`;
                }
            }
        }
    }

    startTrimming(e, mode) {
        this.historyManager.pushState();
        this.isTrimmingClip = true;
        this.trimMode = mode;

        const clipEl = e.target.closest('.clip');
        const clipId = clipEl.dataset.id;

        // Find the clip
        for (const trackId in this.tracks) {
            const clip = this.tracks[trackId].find(c => c.id === clipId);
            if (clip) {
                this.trimClip = clip;
                this.trimStartX = e.clientX;
                this.trimOriginalStart = clip.startTime;
                this.trimOriginalDuration = clip.duration;
                this.trimOriginalTrimStart = clip.trimStart || 0;
                break;
            }
        }
    }

    zoomIn() {
        this.adjustZoom(1);
    }

    zoomOut() {
        this.adjustZoom(-1);
    }

    adjustZoom(delta) {
        // Multiplicative zoom for better feel over large range
        const factor = delta > 0 ? 1.2 : 0.8;
        let newZoom = this.zoom * factor;
        
        // Clamp
        newZoom = Math.max(0.1, Math.min(200, newZoom));
        
        this.setZoom(newZoom);
    }

    setZoom(newZoom) {
        if (newZoom === this.zoom) return;

        // Store scroll position
        const scrollLeft = this.tracksContainer.scrollLeft;
        const scrollRatio = scrollLeft / (this.tracksContainer.scrollWidth - this.tracksContainer.clientWidth);

        this.zoom = newZoom;

        // Update zoom slider
        const zoomSlider = document.getElementById('zoom-slider');
        if (zoomSlider) {
            zoomSlider.value = newZoom;
        }

        // Re-render
        this.renderRuler();
        this.updateAllClips();

        // Update playhead position
        const playheadX = this.currentTime * this.zoom;
        this.playhead.style.transform = `translateX(${playheadX}px)`;

        // Restore scroll position proportionally
        setTimeout(() => {
            const newScrollWidth = this.tracksContainer.scrollWidth - this.tracksContainer.clientWidth;
            this.tracksContainer.scrollLeft = scrollRatio * newScrollWidth;
        }, 0);
    }

    updateAllClips() {
        // Remove all clip elements
        const allClipEls = this.tracksContainer.querySelectorAll('.clip');
        allClipEls.forEach(el => el.remove());

        // Re-render all clips
        for (const trackId in this.tracks) {
            this.tracks[trackId].forEach(clip => {
                this.renderClip(clip);
            });
        }

        // Restore selected clip
        if (this.selectedClip) {
            const el = document.querySelector(`.clip[data-id="${this.selectedClip.id}"]`);
            if (el) {
                el.classList.add('selected');
            }
        }
    }

    renderAllClips() {
        this.updateAllClips();
    }

    async generateThumbnail(canvas, clip) {
        const asset = this.app.assetsManager.getAssetById(clip.assetId);
        if (!asset) return;

        // Handle image assets
        if (clip.isImage || asset.type === 'image') {
            const ctx = canvas.getContext('2d');
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = asset.url;

            try {
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                });
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            } catch (e) {
                console.error('Error generating image thumbnail:', e);
                // Draw error placeholder
                ctx.fillStyle = '#333';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#fff';
                ctx.font = '12px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('Error', canvas.width / 2, canvas.height / 2);
            }
            return;
        }

        try {
            // Create a temporary video element
            const video = document.createElement('video');
            video.src = asset.url;
            video.muted = true;
            video.preload = 'metadata';
            video.crossOrigin = 'anonymous';

            // Wait for video to load with timeout
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Video load timeout'));
                }, 5000);

                video.addEventListener('loadedmetadata', () => {
                    clearTimeout(timeout);
                    resolve();
                }, { once: true });

                video.addEventListener('error', (e) => {
                    clearTimeout(timeout);
                    reject(e);
                }, { once: true });

                video.load();
            });

            // Seek to the trimStart position (for cut clips)
            const thumbnailTime = Math.min(clip.trimStart || 0, video.duration - 0.1);
            video.currentTime = thumbnailTime;

            // Wait for seek to complete with timeout
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    resolve(); // Continue even if seek doesn't complete
                }, 3000);

                video.addEventListener('seeked', () => {
                    clearTimeout(timeout);
                    resolve();
                }, { once: true });
            });

            // Wait a bit for frame to be ready
            await new Promise(resolve => setTimeout(resolve, 100));

            // Draw thumbnail
            const ctx = canvas.getContext('2d');
            if (video.readyState >= 2) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            } else {
                // Draw placeholder if video not ready
                ctx.fillStyle = '#333';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#fff';
                ctx.font = '12px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('Video', canvas.width / 2, canvas.height / 2);
            }

            // Clean up
            video.src = '';
            video.remove();
        } catch (error) {
            console.error('Error generating thumbnail:', error);
            // Draw error placeholder
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#333';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#fff';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('Error', canvas.width / 2, canvas.height / 2);
        }
    }

    getSnappedTime(targetTime, draggedClip) {
        const snapPoints = [];
        const clipEndTime = targetTime + draggedClip.duration;

        // Add timeline start as snap point
        snapPoints.push(0);

        // Add playhead position as snap point
        snapPoints.push(this.currentTime);

        // Add all other clips' start and end times as snap points
        for (const trackId in this.tracks) {
            this.tracks[trackId].forEach(clip => {
                // Skip the dragged clip itself
                if (clip.id === draggedClip.id) return;

                // Add clip start and end times
                snapPoints.push(clip.startTime);
                snapPoints.push(clip.startTime + clip.duration);
            });
        }

        // Check if clip start snaps to any point
        for (const snapPoint of snapPoints) {
            if (Math.abs(targetTime - snapPoint) < this.snapThreshold) {
                return snapPoint;
            }
        }

        // Check if clip end snaps to any point
        for (const snapPoint of snapPoints) {
            if (Math.abs(clipEndTime - snapPoint) < this.snapThreshold) {
                return snapPoint - draggedClip.duration;
            }
        }

        return targetTime;
    }

    drawWaveform(canvas, clip) {
        const ctx = canvas.getContext('2d');
        const waveformData = this.app.assetsManager.getWaveformData(clip.assetId);

        if (!waveformData) {
            // If waveform not ready yet, try again after a short delay
            setTimeout(() => {
                const data = this.app.assetsManager.getWaveformData(clip.assetId);
                if (data) {
                    this.drawWaveform(canvas, clip);
                }
            }, 500);
            return;
        }

        const asset = this.app.assetsManager.getAssetById(clip.assetId);
        if (!asset || !asset.duration) return;

        const width = canvas.width;
        const height = canvas.height;
        const middleY = height / 2;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Draw waveform
        ctx.fillStyle = 'rgba(61, 90, 254, 0.6)';
        ctx.strokeStyle = 'rgba(61, 90, 254, 0.9)';
        ctx.lineWidth = 1;

        // Calculate which portion of the waveform to display
        const trimStart = clip.trimStart || 0;
        const clipDuration = clip.duration;
        const assetDuration = asset.duration;

        // Calculate start and end indices in the waveform data array
        const startRatio = trimStart / assetDuration;
        const endRatio = (trimStart + clipDuration) / assetDuration;
        const startIndex = Math.floor(startRatio * waveformData.length);
        const endIndex = Math.ceil(endRatio * waveformData.length);

        // Extract the visible portion of waveform
        const visibleWaveform = waveformData.slice(startIndex, endIndex);

        if (visibleWaveform.length === 0) return;

        const barWidth = width / visibleWaveform.length;

        ctx.beginPath();
        for (let i = 0; i < visibleWaveform.length; i++) {
            const x = i * barWidth;
            const barHeight = visibleWaveform[i] * (height / 2) * 0.9;

            // Draw bar from middle
            ctx.fillRect(x, middleY - barHeight / 2, Math.max(barWidth, 1), barHeight);
        }
        ctx.closePath();
    }

    handleTrimDrag(e) {
        if (!this.trimClip) return;

        const deltaX = e.clientX - this.trimStartX;
        const deltaTime = deltaX / this.zoom;

        let newStartTime = this.trimClip.startTime;
        let newDuration = this.trimClip.duration;
        let newTrimStart = this.trimClip.trimStart;

        if (this.trimMode === 'start') {
            // Trim from start
            newStartTime = this.trimOriginalStart + deltaTime;
            newDuration = this.trimOriginalDuration - deltaTime;
            newTrimStart = this.trimOriginalTrimStart + deltaTime;

            // Constraints
            const maxTrim = this.trimOriginalDuration - 0.1; // Minimum 0.1s duration
            if (deltaTime > maxTrim) {
                newStartTime = this.trimOriginalStart + maxTrim;
                newDuration = 0.1;
                newTrimStart = this.trimOriginalTrimStart + maxTrim;
            }
            if (newStartTime < 0) {
                newStartTime = 0;
                newDuration = this.trimOriginalDuration + this.trimOriginalStart;
                newTrimStart = Math.max(0, this.trimOriginalTrimStart - this.trimOriginalStart);
            }
            // Don't trim beyond original video start
            if (newTrimStart < 0) {
                const adjustment = -newTrimStart;
                newTrimStart = 0;
                newStartTime = this.trimOriginalStart - this.trimOriginalTrimStart;
                newDuration = this.trimOriginalDuration + this.trimOriginalTrimStart;
            }
        } else if (this.trimMode === 'end') {
            // Trim from end
            newDuration = this.trimOriginalDuration + deltaTime;

            // Constraints
            if (newDuration < 0.1) {
                newDuration = 0.1;
            }
            // Don't extend beyond original video duration
            const asset = this.app.assetsManager.getAssetById(this.trimClip.assetId);
            if (asset && asset.duration) {
                const currentTrimStart = this.trimClip.trimStart || 0;
                const maxDuration = asset.duration - currentTrimStart;
                if (newDuration > maxDuration) {
                    newDuration = maxDuration;
                }
            }
        }

        // Check for triple overlap
        if (this.checkOverlap(this.trimClip.trackId, newStartTime, newDuration, this.trimClip.id)) {
            return;
        }

        this.trimClip.startTime = newStartTime;
        this.trimClip.duration = newDuration;
        if (this.trimMode === 'start') {
            this.trimClip.trimStart = newTrimStart;
        }

        // Update DOM
        this.updateClipElement(this.trimClip);
    }

    setInteractive(enabled) {
        this.isInteractive = enabled;
        // Allow scrubbing during export, so we don't disable pointer events globally.
        // Editing actions are guarded in event listeners.
    }

    startGainDrag(e, clip) {
        this.historyManager.pushState();
        this.isDraggingGain = true;
        this.draggedGainClip = clip;
    }

    handleGainDrag(e) {
        if (!this.draggedGainClip) return;

        const clipEl = document.querySelector(`.clip[data-id="${this.draggedGainClip.id}"]`);
        if (!clipEl) return;

        const rect = clipEl.getBoundingClientRect();
        // Calculate normalized Y position (0 at bottom, 1 at top)
        // e.clientY is mouse Y. rect.bottom is bottom Y.
        // Distance from bottom = rect.bottom - e.clientY
        let y = (rect.bottom - e.clientY) / rect.height;

        // Clamp y between 0 and 1
        y = Math.max(0, Math.min(1, y));

        const db = this.getDBFromNormalizedY(y);
        this.draggedGainClip.gain = db;

        // Update DOM
        this.updateClipElement(this.draggedGainClip);

        // Update properties panel if selected
        if (this.selectedClip && this.selectedClip.id === this.draggedGainClip.id) {
            this.updatePropertiesPanel();
        }
    }

    getNormalizedYFromDB(db) {
        if (db >= 0) {
            // 0dB -> 0.5, 10dB -> 1.0
            return 0.5 + (db / 20);
        } else {
            // -inf -> 0, 0dB -> 0.5
            // using 20*log10(2*y) = db
            // log10(2*y) = db/20
            // 2*y = 10^(db/20)
            // y = 0.5 * 10^(db/20)
            return 0.5 * Math.pow(10, db / 20);
        }
    }

    getDBFromNormalizedY(y) {
        if (y >= 0.5) {
            return (y - 0.5) * 20;
        } else {
            if (y <= 0.001) return -60; // Clamp to -60dB as mute
            return 20 * Math.log10(2 * y);
        }
    }
}
