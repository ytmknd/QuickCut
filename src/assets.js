export class AssetsManager {
    constructor(app) {
        this.app = app;
        this.assets = [];
        this.uploadArea = document.getElementById('upload-area');
        this.fileInput = document.getElementById('file-input');
        this.assetsList = document.getElementById('assets-list');
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.waveformCache = new Map(); // Store waveform data by asset ID

        this.initListeners();
    }

    initListeners() {
        this.uploadArea.addEventListener('click', () => {
            this.fileInput.click();
        });

        this.fileInput.addEventListener('change', (e) => {
            this.handleFiles(e.target.files);
        });

        this.uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.uploadArea.style.borderColor = 'var(--accent)';
        });

        this.uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            this.uploadArea.style.borderColor = 'var(--border)';
        });

        this.uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            this.uploadArea.style.borderColor = 'var(--border)';
            this.handleFiles(e.dataTransfer.files);
        });
    }

    handleFiles(files) {
        Array.from(files).forEach(file => {
            if (file.type.startsWith('video/') || file.type.startsWith('audio/') || file.type.startsWith('image/')) {
                this.addAsset(file);
            }
        });
    }

    async addAsset(file) {
        const url = URL.createObjectURL(file);
        let type = 'video';
        if (file.type.startsWith('audio/')) {
            type = 'audio';
        } else if (file.type.startsWith('image/')) {
            type = 'image';
        }
        
        const asset = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            file: file,
            url: url,
            type: type,
            name: file.name,
            duration: type === 'image' ? 30 : undefined // Default 30 seconds for images
        };

        // For audio files, try to get duration from metadata immediately
        if (type === 'audio') {
            const audio = new Audio(url);
            audio.preload = 'metadata';
            audio.addEventListener('loadedmetadata', () => {
                if (!asset.duration) {
                    asset.duration = audio.duration;
                    console.log('Audio duration loaded from metadata:', asset.duration);
                }
            });
        }

        this.assets.push(asset);
        this.renderAsset(asset);
        
        // Generate waveform for audio files and video files (for their audio track)
        if (asset.type === 'audio') {
            await this.generateWaveform(asset);
        } else if (asset.type === 'video') {
            // Try to generate waveform, but don't fail if video has no audio
            await this.generateWaveform(asset).catch(() => {
                console.log('Video has no audio track or audio could not be decoded');
            });
        }
    }

    renderAsset(asset) {
        const el = document.createElement('div');
        el.className = 'asset-item';
        el.draggable = true;
        el.dataset.id = asset.id;

        if (asset.type === 'video') {
            const video = document.createElement('video');
            video.src = asset.url;
            video.muted = true;
            video.preload = 'metadata'; // Load metadata to get duration

            video.addEventListener('loadedmetadata', () => {
                asset.duration = video.duration;
                // Update duration display if we had one, or just store it
            });

            // Capture a frame for thumbnail (simplified)
            video.addEventListener('loadeddata', () => {
                video.currentTime = 0;
            });
            el.appendChild(video);
        } else if (asset.type === 'image') {
            const img = document.createElement('img');
            img.src = asset.url;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            el.appendChild(img);
        } else {
            // Audio placeholder
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.justifyContent = 'center';
            div.style.alignItems = 'center';
            div.style.height = '100%';
            div.style.background = '#444';
            div.textContent = '🎵';
            el.appendChild(div);
        }

        const name = document.createElement('div');
        name.className = 'asset-name';
        name.textContent = asset.name;
        el.appendChild(name);

        // Add delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'asset-delete-btn';
        deleteBtn.innerHTML = '×';
        deleteBtn.title = 'Delete asset';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteAsset(asset.id);
        });
        el.appendChild(deleteBtn);

        el.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('application/json', JSON.stringify(asset));
            e.dataTransfer.effectAllowed = 'copy';
        });

        this.assetsList.appendChild(el);
    }

    getAssetById(id) {
        return this.assets.find(a => a.id === id);
    }
    
    async generateWaveform(asset) {
        try {
            const response = await fetch(asset.url);
            const arrayBuffer = await response.arrayBuffer();
            
            // Clone the array buffer for decoding
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));
            
            // Store duration if not already set
            if (!asset.duration) {
                asset.duration = audioBuffer.duration;
            }
            
            // Check if audio has any channels
            if (audioBuffer.numberOfChannels === 0) {
                throw new Error('No audio channels found');
            }
            
            // Get audio data from first channel
            const channelData = audioBuffer.getChannelData(0);
            const samples = 1000; // Number of samples for waveform visualization
            const blockSize = Math.floor(channelData.length / samples);
            const waveformData = [];
            
            for (let i = 0; i < samples; i++) {
                const start = blockSize * i;
                let sum = 0;
                for (let j = 0; j < blockSize; j++) {
                    sum += Math.abs(channelData[start + j]);
                }
                waveformData.push(sum / blockSize);
            }
            
            // Normalize waveform data
            const max = Math.max(...waveformData);
            const normalized = max > 0 ? waveformData.map(v => v / max) : waveformData;
            
            this.waveformCache.set(asset.id, normalized);
            asset.hasAudio = true;
        } catch (error) {
            // For videos without audio or decode errors, create a flat waveform
            if (asset.type === 'video') {
                console.log('Video has no audio track, skipping waveform generation');
                // Don't create a default waveform for videos without audio
                // This way we won't try to draw waveforms for them
                asset.hasAudio = false;
                return;
            }
            console.error('Error generating waveform:', error);
            // Create a default flat waveform on error for audio files
            const defaultWaveform = new Array(1000).fill(0.1);
            this.waveformCache.set(asset.id, defaultWaveform);
            asset.hasAudio = true;
        }
    }
    
    getWaveformData(assetId) {
        return this.waveformCache.get(assetId);
    }

    deleteAsset(assetId) {
        // Check if asset is used in timeline
        const isUsed = this.app.timelineManager.isAssetInUse(assetId);
        
        if (isUsed) {
            alert('This asset is currently used in the timeline and cannot be deleted. Please remove all clips using this asset first.');
            return;
        }

        // Find and remove asset
        const index = this.assets.findIndex(a => a.id === assetId);
        if (index === -1) return;

        const asset = this.assets[index];
        
        // Revoke object URL to free memory
        URL.revokeObjectURL(asset.url);
        
        // Remove from assets array
        this.assets.splice(index, 1);
        
        // Remove from waveform cache if exists
        this.waveformCache.delete(assetId);
        
        // Remove DOM element
        const el = document.querySelector(`.asset-item[data-id="${assetId}"]`);
        if (el) {
            el.remove();
        }
        
        console.log('Asset deleted:', assetId);
    }
}
