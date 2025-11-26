export class Exporter {
    constructor(app) {
        this.app = app;
        this.exportBtn = document.getElementById('export-btn');
        this.ffmpeg = null;
        this.loaded = false;
        this.isExporting = false;
        this.abortController = null;

        this.init();
    }

    async init() {
        this.exportBtn.addEventListener('click', () => {
            if (this.isExporting) {
                if (confirm('エクスポートを中止しますか？')) {
                    this.cancelExport();
                }
            } else {
                this.exportVideo();
            }
        });
    }

    cancelExport() {
        if (this.abortController) {
            this.abortController.abort();
        }
        if (this.ffmpeg) {
            try {
                this.ffmpeg.terminate();
            } catch (e) {
                console.error('Failed to terminate FFmpeg:', e);
            }
            this.ffmpeg = null;
            this.loaded = false;
        }
    }

    async loadFFmpeg(signal) {
        if (this.loaded) return;

        try {
            // Import FFmpeg modules from local public/lib for GitHub Pages compatibility
            const { FFmpeg } = await import('../public/lib/ffmpeg/index.js');
            const { fetchFile, toBlobURL } = await import('../public/lib/util/index.js');
            
            this.ffmpeg = new FFmpeg();
            this.fetchFile = fetchFile;
            
            // Setup logging
            this.ffmpeg.on('log', ({ message }) => {
                if (message === 'Aborted()') return;
                console.log('[FFmpeg]', message);
            });

            this.ffmpeg.on('progress', ({ progress }) => {
                const percent = Math.round(progress * 100);
                this.exportBtn.textContent = `エクスポート中... ${percent}% (クリックで中止)`;
            });

            // Load local FFmpeg core files
            // Use relative path for GitHub Pages compatibility
            
            console.log('Loading FFmpeg from local files (Multi-threaded)...');
            
            // Fetch core file text
            const coreResponse = await fetch('public/ffmpeg-core.js', { signal });
            if (!coreResponse.ok) throw new Error('Failed to fetch ffmpeg-core.js');
            let coreText = await coreResponse.text();
            
            // Fix: Append export statement to make it a valid ES module
            if (!coreText.includes('export default createFFmpegCore')) {
                coreText += '\nexport default createFFmpegCore;';
            }
            
            const coreBlob = new Blob([coreText], { type: 'text/javascript' });
            const coreURL = URL.createObjectURL(coreBlob);
            
            const wasmURL = await toBlobURL('public/ffmpeg-core.wasm', 'application/wasm');
            const workerURL = await toBlobURL('public/ffmpeg-core.worker.js', 'text/javascript');
            
            console.log('Core blob URL (patched):', coreURL);
            console.log('Wasm blob URL:', wasmURL);
            console.log('Worker blob URL:', workerURL);
            
            await this.ffmpeg.load({
                coreURL: coreURL,
                wasmURL: wasmURL,
                workerURL: workerURL,
            }, { signal });

            this.loaded = true;
            console.log('FFmpeg loaded successfully from local files');
        } catch (error) {
            console.error('Failed to load FFmpeg:', error);
            console.error('Error details:', error.message, error.stack);
            throw error;
        }
    }

    // Render timeline frame-by-frame to individual images
    async renderTimelineToBlob(format = 'mp4') {
        const timeline = this.app.timelineManager;
        const preview = this.app.previewPlayer;
        const canvas = preview.canvas;
        const duration = timeline.duration;

        // Create MediaStream from canvas
        const stream = canvas.captureStream(30); // 30 FPS
        
        // Add audio tracks if available
        const audioTracks = [];
        const clips = timeline.getAllClips();
        
        for (const clip of clips) {
            const asset = this.app.assetsManager.getAssetById(clip.assetId);
            if (asset.type === 'video' || asset.type === 'audio') {
                const videoEl = document.createElement(asset.type);
                videoEl.src = asset.url;
                await new Promise((resolve) => {
                    videoEl.onloadedmetadata = resolve;
                });
                
                const ctx = new AudioContext();
                const source = ctx.createMediaElementSource(videoEl);
                const dest = ctx.createMediaStreamDestination();
                source.connect(dest);
                
                audioTracks.push({ source: videoEl, stream: dest.stream, clip });
            }
        }

        // Setup MediaRecorder with H.264/MP4 if supported, otherwise WebM
        let options = {};
        let mimeType = '';
        
        if (format === 'mp4') {
            // Try H.264 in MP4 container
            const mp4Types = [
                'video/mp4;codecs=avc1.42E01E,mp4a.40.2', // H.264 Baseline + AAC
                'video/mp4;codecs=avc1.4D401E,mp4a.40.2', // H.264 Main + AAC
                'video/mp4;codecs=h264,aac',
                'video/mp4'
            ];
            
            for (const type of mp4Types) {
                if (MediaRecorder.isTypeSupported(type)) {
                    mimeType = type;
                    break;
                }
            }
        }
        
        // Fallback to WebM if MP4 not supported
        if (!mimeType) {
            const webmTypes = [
                'video/webm;codecs=vp9,opus',
                'video/webm;codecs=vp8,opus',
                'video/webm'
            ];
            
            for (const type of webmTypes) {
                if (MediaRecorder.isTypeSupported(type)) {
                    mimeType = type;
                    break;
                }
            }
        }

        if (!mimeType) {
            throw new Error('ブラウザが対応している動画フォーマットがありません');
        }

        options = {
            mimeType: mimeType,
            videoBitsPerSecond: 5000000
        };

        console.log('Recording with:', mimeType);

        const mediaRecorder = new MediaRecorder(stream, options);
        const chunks = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                chunks.push(e.data);
            }
        };

        return new Promise((resolve, reject) => {
            mediaRecorder.onstop = () => {
                const blob = new Blob(chunks, { type: mimeType });
                resolve({ blob, mimeType });
            };

            mediaRecorder.onerror = (e) => {
                reject(new Error('Recording failed: ' + e.error));
            };

            // Start recording
            mediaRecorder.start(100); // Collect data every 100ms

            // Play through timeline - use fixed timestep for consistent rendering
            let currentTime = 0;
            const fps = 30;
            const frameTime = 1 / fps;
            const totalFrames = Math.ceil(duration * fps);
            let frameCount = 0;

            const renderFrame = () => {
                // Render current frame
                preview.render(currentTime);
                
                // Move to next frame
                frameCount++;
                currentTime = frameCount * frameTime;

                if (currentTime >= duration || frameCount >= totalFrames) {
                    // Render final frame
                    preview.render(duration);
                    
                    // Stop recording after a short delay to ensure last frame is captured
                    setTimeout(() => {
                        mediaRecorder.stop();
                        // Cleanup audio
                        audioTracks.forEach(({ source }) => {
                            source.pause();
                            source.src = '';
                        });
                    }, 200);
                } else {
                    // Use timeout instead of requestAnimationFrame for consistent timing
                    setTimeout(() => renderFrame(), frameTime * 1000);
                }
            };

            // Start rendering
            renderFrame();
        });
    }

    async exportVideo() {
        const clips = this.app.timelineManager.getAllClips();
        if (clips.length === 0) {
            alert('タイムラインにクリップがありません');
            return;
        }

        this.isExporting = true;
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        // Don't disable button, just change text
        this.app.timelineManager.setInteractive(false); // Disable timeline interaction
        this.exportBtn.textContent = 'FFmpeg読み込み中... (クリックで中止)';

        try {
            // Load FFmpeg
            await this.loadFFmpeg(signal);
            
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

            this.exportBtn.textContent = 'ファイル準備中... (クリックで中止)';
            
            // Write source files to FFmpeg virtual filesystem
            const assetIds = [...new Set(clips.map(c => c.assetId))];
            const assetMap = {};
            
            for (let i = 0; i < assetIds.length; i++) {
                if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

                const asset = this.app.assetsManager.getAssetById(assetIds[i]);
                const data = await this.fetchFile(asset.url);
                const filename = `input${i}${this.getFileExtension(asset.name)}`;
                await this.ffmpeg.writeFile(filename, data);
                assetMap[assetIds[i]] = { index: i, filename, asset };
            }

            this.exportBtn.textContent = 'エクスポート中... (クリックで中止)';

            // Build FFmpeg filter_complex command
            const fps = 30;
            const width = 1280;
            const height = 720;
            
            // Calculate actual duration from clips
            let maxEndTime = 0;
            clips.forEach(clip => {
                const clipEndTime = clip.startTime + clip.duration;
                if (clipEndTime > maxEndTime) {
                    maxEndTime = clipEndTime;
                }
            });
            const duration = maxEndTime;

            // Sort clips by track and time
            // v1 (bottom) -> v2 (top) -> a1 -> a2
            const sortedClips = clips.sort((a, b) => {
                if (a.trackId !== b.trackId) return a.trackId.localeCompare(b.trackId);
                return a.startTime - b.startTime;
            });

            let filterParts = [];
            let inputArgs = [];
            let audioStreams = [];
            
            // Add inputs
            for (let i = 0; i < assetIds.length; i++) {
                inputArgs.push('-i', assetMap[assetIds[i]].filename);
            }

            // --- Video Processing ---
            // Start with black background
            let currentStream = '[bg]';
            filterParts.push(`color=c=black:s=${width}x${height}:d=${duration}[bg]`);

            // Process each clip for Video
            for (let i = 0; i < sortedClips.length; i++) {
                const clip = sortedClips[i];
                const { index: inputIndex, asset } = assetMap[clip.assetId];
                const clipLabel = `v${i}`;
                const nextStream = i === sortedClips.length - 1 ? '[outv]' : `[tmp${i}]`;
                
                // Skip audio-only clips for video processing
                if (asset.type === 'audio') continue;

                let overlayX = 0;
                let overlayY = 0;
                let clipFilterChain = '';

                if (asset.type === 'image') {
                    const imgScale = clip.imageScale || 1.0;
                    overlayX = clip.imageX || 0;
                    overlayY = clip.imageY || 0;

                    // Ensure dimensions are even for libx264
                    clipFilterChain = `[${inputIndex}:v]loop=loop=-1:size=1:start=0,scale=trunc(iw*${imgScale}/2)*2:trunc(ih*${imgScale}/2)*2,trim=duration=${clip.duration},setpts=PTS-STARTPTS+${clip.startTime}/TB[${clipLabel}]`;
                } else {
                    // Video: Scale to fit 1280x720 with black bars
                    clipFilterChain = `[${inputIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,trim=start=${clip.trimStart || 0}:duration=${clip.duration},setpts=PTS-STARTPTS+${clip.startTime}/TB[${clipLabel}]`;
                }
                
                filterParts.push(clipFilterChain);

                // Overlay onto current stream
                // eof_action=pass ensures the background continues even if overlay ends
                filterParts.push(`${currentStream}[${clipLabel}]overlay=${overlayX}:${overlayY}:eof_action=pass${nextStream}`);
                
                currentStream = nextStream;
            }

            // Finalize Video Output
            if (currentStream === '[bg]') {
                filterParts.push(`[bg]null[outv]`);
            } else if (currentStream !== '[outv]') {
                filterParts.push(`${currentStream}null[outv]`);
            }

            // --- Audio Processing ---
            for (let i = 0; i < sortedClips.length; i++) {
                const clip = sortedClips[i];
                const { index: inputIndex, asset } = assetMap[clip.assetId];
                
                // Skip images
                if (asset.type === 'image') continue;

                // Skip videos with no audio track
                if (asset.type === 'video' && !this.app.assetsManager.getWaveformData(asset.id)) {
                    console.log(`Skipping audio for video clip ${clip.id} (no audio track detected)`);
                    continue;
                }

                const clipLabel = `a${i}`;
                const trimStart = clip.trimStart || 0;
                const duration = clip.duration;
                const startTimeMs = Math.round(clip.startTime * 1000);
                const gain = clip.gain || 0; // dB
                
                // Filter chain: [in]atrim,asetpts,volume,adelay[out]
                let chain = `[${inputIndex}:a]atrim=start=${trimStart}:duration=${duration},asetpts=PTS-STARTPTS`;
                
                if (gain !== 0) {
                    chain += `,volume=${gain}dB`;
                }
                
                if (startTimeMs > 0) {
                    chain += `,adelay=${startTimeMs}|${startTimeMs}`;
                }
                
                chain += `[${clipLabel}]`;
                filterParts.push(chain);
                audioStreams.push(`[${clipLabel}]`);
            }

            // Mix Audio
            if (audioStreams.length > 0) {
                const mixInput = audioStreams.join('');
                // normalize=0 to prevent volume drop
                filterParts.push(`${mixInput}amix=inputs=${audioStreams.length}:duration=longest:dropout_transition=0[outa]`);
            } else {
                // Silent audio
                filterParts.push(`anullsrc=channel_layout=stereo:sample_rate=44100:d=${duration}[outa]`);
            }

            const filterComplex = filterParts.join(';');
            console.log('Filter Complex:', filterComplex);

            // Execute FFmpeg
            const outputFilename = 'output.mp4';
            const execPromise = this.ffmpeg.exec([
                ...inputArgs,
                '-filter_complex', filterComplex,
                '-map', '[outv]',
                '-map', '[outa]',
                '-c:v', 'libx264',
                '-c:a', 'aac',
                '-preset', 'ultrafast', // Faster encoding for testing
                '-pix_fmt', 'yuv420p',
                '-r', fps.toString(),
                outputFilename
            ]);

            // Wait for execution or abort
            await Promise.race([
                execPromise,
                new Promise((_, reject) => {
                    if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
                    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
                })
            ]);

            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

            // Read output file
            const data = await this.ffmpeg.readFile(outputFilename);
            const blob = new Blob([data.buffer], { type: 'video/mp4' });
            
            console.log('Export complete, size:', (blob.size / 1024 / 1024).toFixed(2), 'MB');

            // Download
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `quickcut_export_${Date.now()}.mp4`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            setTimeout(() => URL.revokeObjectURL(url), 100);

            // alert(`エクスポート完了!\nサイズ: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);

        } catch (e) {
            if (e.name === 'AbortError' || e.message === 'Aborted') {
                console.log('Export aborted by user');
            } else {
                console.error('Export failed:', e);
                alert('エクスポートに失敗しました: ' + e.message);
            }
        } finally {
            this.isExporting = false;
            this.abortController = null;
            this.exportBtn.textContent = 'Export Video';
            this.exportBtn.disabled = false;
            this.app.timelineManager.setInteractive(true); // Re-enable timeline interaction
        }
    }

    getFileExtension(filename) {
        const lastDot = filename.lastIndexOf('.');
        return lastDot !== -1 ? filename.substring(lastDot) : '';
    }
}
